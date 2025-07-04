<?php

use PhpCfdi\CfdiSatScraper\SatScraper;
use PhpCfdi\CfdiSatScraper\ResourceType;
use PhpCfdi\CfdiSatScraper\MetadataList;
use PhpCfdi\CfdiSatScraper\NullMetadataMessageHandler;
use GuzzleHttp\Client;
use GuzzleHttp\RequestOptions;
use PhpCfdi\CfdiSatScraper\SatHttpGateway;
use GuzzleHttp\Cookie\FileCookieJar;
use PhpCfdi\CfdiSatScraper\Sessions\Ciec\CiecSessionData;
use PhpCfdi\CfdiSatScraper\Sessions\Ciec\CiecSessionManager;

class AvisosMetadataHandler extends NullMetadataMessageHandler
{
    public $avisos = [];
    public function maximum(DateTimeImmutable $date): void
    {
        $this->avisos[] = "⚠️ Se encontraron más de 500 CFDI en el segundo: " . $date->format('c');
    }
    public function divide(DateTimeImmutable $since, DateTimeImmutable $until): void
    {
        $this->avisos[] = "División automática de rango: " . $since->format('Y-m-d') . " a " . $until->format('Y-m-d') . " por exceso de registros";
    }
}

class CfdiController
{
    private static function requireSession($data)
    {
        $rfc = trim($data['rfc'] ?? '');
        if (!$rfc || !isset($_SESSION['sat'][$rfc])) {
            Response::json(['error' => 'No hay sesión activa SAT para este RFC. Por favor inicia sesión primero.'], 401);
        }
        $ciec = $_SESSION['sat'][$rfc]['ciec'] ?? null;
        if (!$ciec) {
            Response::json(['error' => 'La CIEC no está disponible en sesión. Reloguea.'], 401);
        }
        return [$rfc, $ciec];
    }




    public static function search($data)
    {
        [$rfc, $ciec] = self::requireSession($data);
        $metadataHandler = new AvisosMetadataHandler();
        $filtros = FiltersHelper::get($data);

        $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
        $query = FiltersHelper::buildQuery($filtros);
        $list = $satScraper->listByPeriod($query);
        $allCfdis = iterator_to_array($list);

        $total = count($allCfdis);
        $vigentes = count(array_filter($allCfdis, fn($c) => $c->get('estadoComprobante') === 'Vigente'));
        $cancelados = count(array_filter($allCfdis, fn($c) => $c->get('estadoComprobante') === 'Cancelado'));
        $noIdentificados = $total - $vigentes - $cancelados;
        $cfdisToShow = array_slice($allCfdis, 0, MAX_VISUAL);

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

    public static function download($data)
    {
        [$rfc, $ciec] = self::requireSession($data);
        $metadataHandler = new AvisosMetadataHandler();
        $selectedUuids = $data['selectedUuids'] ?? [];
        if (empty($selectedUuids)) Response::json(['error' => 'No se proporcionaron UUIDs para descargar'], 400);

        $filtros = FiltersHelper::get($data);
        $resourceType = strtolower($filtros['downloadType']) === 'pdf' ? ResourceType::pdf() : ResourceType::xml();

        $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
        $query = FiltersHelper::buildQuery($filtros);
        $list = $satScraper->listByPeriod($query);
        $allCfdis = iterator_to_array($list);

        $cfdisToDownload = array_filter($allCfdis, fn($cfdi) => in_array($cfdi->uuid(), $selectedUuids));
        if (empty($cfdisToDownload)) Response::json(['error' => 'No se encontraron CFDI para descargar.'], 400);

        $downloadList = new MetadataList($cfdisToDownload);
        $descargados = [];
        try {
            $descargados = $satScraper->resourceDownloader($resourceType, $downloadList)
                ->setConcurrency(count($cfdisToDownload))
                ->saveTo(DESCARGA_PATH, true, 0777);
        } catch (Exception $e) {
            Logger::error("Error en descarga total", $e->getMessage());
        }

        $descargadosUuids = is_array($descargados) ? $descargados : [];
        $faltantes = array_values(array_diff($selectedUuids, $descargadosUuids));

        $mensaje = "Descarga completada. Exitosos: " . count($descargadosUuids) . "/" . count($selectedUuids);
        if (!empty($faltantes)) {
            $mensaje .= ". Pendientes: " . count($faltantes);
        }

        Response::json([
            'status' => empty($faltantes) ? 'COMPLETE' : 'PARTIAL',
            'msg' => $mensaje,
            'descargados' => $descargadosUuids,
            'noDescargados' => $faltantes,
            'avisos' => $metadataHandler->avisos,
        ]);
    }


    public static function retryPending($data)
    {
        [$rfc, $ciec] = self::requireSession($data);
        $metadataHandler = new AvisosMetadataHandler();
        $pendingUuids = $data['pendingUuids'] ?? [];
        if (empty($pendingUuids)) {
            Response::json(['error' => 'No se proporcionaron UUIDs pendientes para reintentar'], 400);
        }

        $filtros = FiltersHelper::get($data);
        $resourceType = strtolower($filtros['downloadType']) === 'pdf' ? ResourceType::pdf() : ResourceType::xml();

        $maxReintentos = min($data['maxReintentos'] ?? RETRY_MAX_RETRIES, MAX_RETRIES_LIMIT);
        $chunkSize = max(MIN_CHUNK_SIZE, min($data['chunkSize'] ?? RETRY_CHUNK_SIZE, 25));
        $delayInicial = $data['delayInicial'] ?? RETRY_INITIAL_DELAY;

        $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
        $query = FiltersHelper::buildQuery($filtros);
        $list = $satScraper->listByPeriod($query);
        $allCfdis = iterator_to_array($list);

        $cfdisToRetry = array_filter($allCfdis, fn($cfdi) => in_array($cfdi->uuid(), $pendingUuids));
        $noListados = array_diff($pendingUuids, array_map(fn($c) => $c->uuid(), $allCfdis));

        if (empty($cfdisToRetry)) {
            Response::json([
                'error' => 'No se encontraron CFDI pendientes para reintentar.',
                'noListados' => $noListados,
                'debugQuery' => $query,
                'debugFiltros' => $filtros
            ], 400);
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

            $chunks = array_chunk($cfdisPendientes, $chunkSize);
            $descargadosEnIntento = [];

            foreach ($chunks as $chunkIndex => $chunk) {
                try {
                    $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
                    $downloadList = new MetadataList($chunk);

                    $resultados = $satScraper->resourceDownloader($resourceType, $downloadList)
                        ->setConcurrency($chunkSize)
                        ->saveTo(DESCARGA_PATH, true, 0777);

                    $descargadosEnIntento = array_merge($descargadosEnIntento, $resultados);
                    if ($chunkIndex < count($chunks) - 1) {
                        usleep(8000000);
                    }
                } catch (Exception $e) {
                    error_log("Error en reintento - chunk $chunkIndex del intento $intento: " . $e->getMessage());
                    if (strpos($e->getMessage(), 'captcha image') !== false) {
                        // Demasiados errores de captcha, aborta y notifica al usuario
                        Response::json([
                            'error' => 'El SAT está bloqueando los captchas por exceso de intentos. Por favor espera unos minutos y vuelve a intentar.'
                        ], 429); // 429 = Too Many Requests
                        break;
                    }
                    usleep(8000000);
                    continue;
                }
            }

            if (empty($descargadosEnIntento)) break;

            $descargados = array_merge($descargados, $descargadosEnIntento);
            $faltantes = array_values(array_diff($pendingUuids, $descargados));
            if (empty($faltantes)) break;

            if ($intento < $maxReintentos && !empty($faltantes)) {
                $jitter = rand(1000, 3000);
                usleep($tiempoEspera * 1000 + $jitter * 1000);
                $tiempoEspera = min($tiempoEspera * 2, 60000);
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
            'noListados' => $noListados,
            'intentos' => $intento,
            'porcentajeExito' => $porcentajeExito,
            'avisos' => $metadataHandler->avisos,
        ]);
    }

    // --- CREA EL SCRAPER USANDO SESIÓN PERSISTENTE ---
    private static function crearSatScraper($rfc, $ciec, $metadataHandler)
    {
        $captchaResolver = \PhpCfdi\ImageCaptchaResolver\BoxFacturaAI\BoxFacturaAIResolver::createFromConfigs(CONFIGS_FILE);

        if (!is_dir(SAT_SESSIONS_PATH)) {
            mkdir(SAT_SESSIONS_PATH, 0775, true);
        }
        $cookieFile = SAT_SESSIONS_PATH . 'sat_session_' . $rfc . '.cookie';

        $sessionManager = CiecSessionManager::create($rfc, $ciec, $captchaResolver, $cookieFile);

        $insecureClient = new \GuzzleHttp\Client([
            \GuzzleHttp\RequestOptions::VERIFY => false
        ]);
        $gateway = new \PhpCfdi\CfdiSatScraper\SatHttpGateway($insecureClient);

        $satScraper = new \PhpCfdi\CfdiSatScraper\SatScraper($sessionManager, $gateway, $metadataHandler);

        try {
            $satScraper->confirmSessionIsAlive();
        } catch (\Throwable $e) {
            // Si la sesión expira, reloguea automáticamente con la CIEC
            $sessionManager->login();
        }

        return $satScraper;
    }
}
