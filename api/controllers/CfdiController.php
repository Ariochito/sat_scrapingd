<?php
use PhpCfdi\CfdiSatScraper\SatScraper;
use PhpCfdi\CfdiSatScraper\ResourceType;
use PhpCfdi\CfdiSatScraper\MetadataList;
use PhpCfdi\CfdiSatScraper\NullMetadataMessageHandler;
use GuzzleHttp\Client;
use GuzzleHttp\RequestOptions;
use PhpCfdi\CfdiSatScraper\SatHttpGateway;

class AvisosMetadataHandler extends NullMetadataMessageHandler {
    public $avisos = [];
    public function maximum(DateTimeImmutable $date): void {
        $this->avisos[] = "⚠️ Se encontraron más de 500 CFDI en el segundo: " . $date->format('c');
    }
    public function divide(DateTimeImmutable $since, DateTimeImmutable $until): void {
        $this->avisos[] = "División automática de rango: " . $since->format('Y-m-d') . " a " . $until->format('Y-m-d') . " por exceso de registros";
    }
}

class CfdiController {
    private static function requireSession($data) {
        $rfc = trim($data['rfc'] ?? '');
        if (!$rfc || !isset($_SESSION['sat'][$rfc])) {
            Response::json(['error'=>'No hay sesión activa SAT para este RFC. Por favor inicia sesión primero.'], 401);
        }
        return [$rfc, $_SESSION['sat'][$rfc]['ciec']];
    }

    public static function search($data) {
    [$rfc, $ciec] = self::requireSession($data);
    $metadataHandler = new AvisosMetadataHandler();
    $filtros = FiltersHelper::get($data);

    $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);

    $query = FiltersHelper::buildQuery($filtros); // <- aquí sigues usando tu helper
    $list = $satScraper->listByPeriod($query);
    $allCfdis = iterator_to_array($list);

    $total = count($allCfdis);
    $vigentes = count(array_filter($allCfdis, fn($c) => $c->get('estadoComprobante') === 'Vigente'));
    $cancelados = count(array_filter($allCfdis, fn($c) => $c->get('estadoComprobante') === 'Cancelado'));
    $noIdentificados = $total - $vigentes - $cancelados;
    $cfdisToShow = array_slice($allCfdis, 0, MAX_VISUAL); // MAX_VISUAL = 200/500 etc.

    $result = [];
    foreach ($cfdisToShow as $cfdi) {
        $result[] = [
            'uuid' => $cfdi->uuid(),
            'emisor' => $cfdi->get('rfcEmisor'),
            'nombreEmisor' => $cfdi->get('nombreEmisor'),
            'receptor' => $cfdi->get('rfcReceptor'),
            'nombreReceptor' => $cfdi->get('nombreReceptor'),
            'fechaEmision' => $cfdi->get('fechaEmision'),
            'fechaCertificacion' => $cfdi->get('fechaCertificacion'),
            'rfcPac' => $cfdi->get('rfcPac'),
            'total' => $cfdi->get('total'),
            'tipo' => $cfdi->get('efectoComprobante'),
            'estatusCancelacion' => $cfdi->get('estatusCancelacion'),
            'estado' => $cfdi->get('estadoComprobante'),
            'estatusProceso' => $cfdi->get('estatusProceso'),
            'fechaCancelacion' => $cfdi->get('fechaCancelacion'),
        ];
    }

    Response::json([
        'cfdis' => $result,
        'total' => $total,
        'mostrados' => count($result),
        'vigentes' => $vigentes,
        'cancelados' => $cancelados,
        'noIdentificados' => $noIdentificados,
        'avisos' => $metadataHandler->avisos,
    ]);
}



    public static function download($data) {
    [$rfc, $ciec] = self::requireSession($data);
    $metadataHandler = new AvisosMetadataHandler();
    $selectedUuids = $data['selectedUuids'] ?? [];
    if (empty($selectedUuids)) Response::json(['error' => 'No se proporcionaron UUIDs para descargar'], 400);

    $filtros = FiltersHelper::get($data);
    $resourceType = strtolower($filtros['downloadType']) === 'pdf' ? ResourceType::pdf() : ResourceType::xml();
    
    // Configuración de reintentos
    $maxReintentos = min($data['maxReintentos'] ?? DEFAULT_MAX_RETRIES, MAX_RETRIES_LIMIT);
    $chunkSize = max(MIN_CHUNK_SIZE, min($data['chunkSize'] ?? DEFAULT_CHUNK_SIZE, MAX_CHUNK_SIZE));
    $delayInicial = $data['delayInicial'] ?? DEFAULT_INITIAL_DELAY;
    
    $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
    $query = FiltersHelper::buildQuery($filtros);
    $list = $satScraper->listByPeriod($query);
    $allCfdis = iterator_to_array($list);

    $cfdisToDownload = array_filter($allCfdis, fn($cfdi) => in_array($cfdi->uuid(), $selectedUuids));
    if (empty($cfdisToDownload)) Response::json(['error' => 'No se encontraron CFDI para descargar.'], 400);

    $totalOriginal = count($selectedUuids);
    $descargados = [];
    $faltantes = $selectedUuids;
    $intento = 0;
    $tiempoEspera = $delayInicial;
    
    while (!empty($faltantes) && $intento < $maxReintentos) {
        $intento++;
        
        // Filtrar CFDIs pendientes
        $cfdisPendientes = array_filter($cfdisToDownload, fn($cfdi) => in_array($cfdi->uuid(), $faltantes));
        
        if (empty($cfdisPendientes)) break;
        
        // Dividir en chunks para evitar timeouts
        $chunks = array_chunk($cfdisPendientes, $chunkSize);
        $descargadosEnIntento = [];
        
        foreach ($chunks as $chunkIndex => $chunk) {
            try {
                $downloadList = new MetadataList($chunk);

                // Recrear scraper si es necesario (por si la sesión expiró)
                if ($intento > 1) {
                    $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
                }

                $resultados = $satScraper->resourceDownloader($resourceType, $downloadList)
                    ->setConcurrency($chunkSize)
                    ->saveTo(DESCARGA_PATH, true, 0777);

                $descargadosEnIntento = array_merge($descargadosEnIntento, $resultados);

                // Breve pausa entre chunks para no saturar el SAT
                if ($chunkIndex < count($chunks) - 1) {
                    usleep(500000); // 0.5 segundos
                }

            } catch (Exception $e) {
                // Log del error específico para debugging
                error_log("Error en chunk $chunkIndex del intento $intento: " . $e->getMessage());

                // Si es error de sesión, intentar reautenticar
                if (strpos($e->getMessage(), 'session') !== false || strpos($e->getMessage(), 'login') !== false) {
                    try {
                        $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
                    } catch (Exception $authError) {
                        // Si falla la reautenticación, abortar este intento
                        break;
                    }
                }

                // Continuar con el siguiente chunk
                continue;
            }
        }

        if (empty($descargadosEnIntento)) {
            // Ningún CFDI se pudo descargar en este intento, salir para evitar ciclo
            break;
        }
        
        // Actualizar listas
        $descargados = array_merge($descargados, $descargadosEnIntento);
        $faltantes = array_values(array_diff($selectedUuids, $descargados));
        
        // Si completamos todo, salir del bucle
        if (empty($faltantes)) break;
        
        // Si no es el último intento, esperar antes del siguiente
        if ($intento < $maxReintentos && !empty($faltantes)) {
            // Espera exponencial con jitter para evitar saturar el SAT
            $jitter = rand(500, 1500); // 0.5-1.5 segundos adicionales aleatorios
            usleep($tiempoEspera * 1000 + $jitter * 1000);
            $tiempoEspera = min($tiempoEspera * 1.5, 30000); // máximo 30 segundos
        }
    }
    
    $porcentajeExito = $totalOriginal > 0 ? round((count($descargados) / $totalOriginal) * 100, 2) : 0;
    
    $mensaje = "Descarga completada en $intento intento(s). ";
    $mensaje .= "Exitosos: " . count($descargados) . "/$totalOriginal ($porcentajeExito%)";
    
    if (!empty($faltantes)) {
        $mensaje .= ". Pendientes: " . count($faltantes);
    }

    Response::json([
        'status' => empty($faltantes) ? 'COMPLETE' : 'PARTIAL',
        'msg' => $mensaje,
        'descargados' => $descargados,
        'noDescargados' => $faltantes,
        'intentos' => $intento,
        'porcentajeExito' => $porcentajeExito,
        'avisos' => $metadataHandler->avisos,
    ]);
}

    public static function retryPending($data) {
        [$rfc, $ciec] = self::requireSession($data);
        $metadataHandler = new AvisosMetadataHandler();
        $pendingUuids = $data['pendingUuids'] ?? [];
        
        if (empty($pendingUuids)) {
            Response::json(['error' => 'No se proporcionaron UUIDs pendientes para reintentar'], 400);
        }
        
        $filtros = FiltersHelper::get($data);
        $resourceType = strtolower($filtros['downloadType']) === 'pdf' ? ResourceType::pdf() : ResourceType::xml();
        
        // Configuración más agresiva para reintentos
        $maxReintentos = min($data['maxReintentos'] ?? RETRY_MAX_RETRIES, MAX_RETRIES_LIMIT);
        $chunkSize = max(MIN_CHUNK_SIZE, min($data['chunkSize'] ?? RETRY_CHUNK_SIZE, 25)); // Chunks más pequeños para reintentos
        $delayInicial = $data['delayInicial'] ?? RETRY_INITIAL_DELAY;
        
        $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
        $query = FiltersHelper::buildQuery($filtros);
        $list = $satScraper->listByPeriod($query);
        $allCfdis = iterator_to_array($list);

        $cfdisToRetry = array_filter($allCfdis, fn($cfdi) => in_array($cfdi->uuid(), $pendingUuids));
        
        if (empty($cfdisToRetry)) {
            Response::json(['error' => 'No se encontraron CFDI pendientes para reintentar.'], 400);
        }

        $totalOriginal = count($pendingUuids);
        $descargados = [];
        $faltantes = $pendingUuids;
        $intento = 0;
        $tiempoEspera = $delayInicial;
        
        while (!empty($faltantes) && $intento < $maxReintentos) {
            $intento++;
            
            $cfdisPendientes = array_filter($cfdisToRetry, fn($cfdi) => in_array($cfdi->uuid(), $faltantes));
            
            if (empty($cfdisPendientes)) break;
            
            // Para reintentos, usar chunks aún más pequeños
            $chunks = array_chunk($cfdisPendientes, $chunkSize);
            $descargadosEnIntento = [];
            
            foreach ($chunks as $chunkIndex => $chunk) {
                try {
                    // Recrear scraper en cada intento para asegurar sesión fresca
                    $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);

                    $downloadList = new MetadataList($chunk);

                    $resultados = $satScraper->resourceDownloader($resourceType, $downloadList)
                        ->setConcurrency($chunkSize)
                        ->saveTo(DESCARGA_PATH, true, 0777);

                    $descargadosEnIntento = array_merge($descargadosEnIntento, $resultados);

                    // Pausa más larga entre chunks en reintentos
                    if ($chunkIndex < count($chunks) - 1) {
                        usleep(1000000); // 1 segundo
                    }

                } catch (Exception $e) {
                    error_log("Error en reintento - chunk $chunkIndex del intento $intento: " . $e->getMessage());

                    // En reintentos, ser más tolerante con errores
                    usleep(2000000); // 2 segundos de pausa si hay error
                    continue;
                }
            }

            if (empty($descargadosEnIntento)) {
                // Si no se descargó nada, abortar para evitar ciclo infinito
                break;
            }
            
            $descargados = array_merge($descargados, $descargadosEnIntento);
            $faltantes = array_values(array_diff($pendingUuids, $descargados));
            
            if (empty($faltantes)) break;
            
            // Espera exponencial más agresiva para reintentos
            if ($intento < $maxReintentos && !empty($faltantes)) {
                $jitter = rand(1000, 3000); // 1-3 segundos adicionales
                usleep($tiempoEspera * 1000 + $jitter * 1000);
                $tiempoEspera = min($tiempoEspera * 2, 60000); // máximo 60 segundos
            }
        }
        
        $porcentajeExito = $totalOriginal > 0 ? round((count($descargados) / $totalOriginal) * 100, 2) : 0;
        
        $mensaje = "Reintento completado en $intento intento(s). ";
        $mensaje .= "Recuperados: " . count($descargados) . "/$totalOriginal ($porcentajeExito%)";
        
        if (!empty($faltantes)) {
            $mensaje .= ". Aún pendientes: " . count($faltantes);
        }

        Response::json([
            'status' => empty($faltantes) ? 'COMPLETE' : 'PARTIAL',
            'msg' => $mensaje,
            'descargados' => $descargados,
            'noDescargados' => $faltantes,
            'intentos' => $intento,
            'porcentajeExito' => $porcentajeExito,
            'avisos' => $metadataHandler->avisos,
        ]);
    }


    private static function crearSatScraper($rfc, $ciec, $metadataHandler) {
        $captchaResolver = \PhpCfdi\ImageCaptchaResolver\BoxFacturaAI\BoxFacturaAIResolver::createFromConfigs(CONFIGS_FILE);
        $sessionManager = \PhpCfdi\CfdiSatScraper\Sessions\Ciec\CiecSessionManager::create($rfc, $ciec, $captchaResolver);

        // -- Aquí el cambio: Cliente Guzzle sin verificación --
        $insecureClient = new \GuzzleHttp\Client([
            \GuzzleHttp\RequestOptions::VERIFY => false
        ]);
        $gateway = new \PhpCfdi\CfdiSatScraper\SatHttpGateway($insecureClient);

        return new SatScraper($sessionManager, $gateway, $metadataHandler);
    }
}
