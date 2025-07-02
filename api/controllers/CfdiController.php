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

    $satScraper = self::crearSatScraper($rfc, $ciec, $metadataHandler);
    $query = FiltersHelper::buildQuery($filtros);
    $list = $satScraper->listByPeriod($query);
    $allCfdis = iterator_to_array($list);

    $cfdisToDownload = array_filter($allCfdis, fn($cfdi) => in_array($cfdi->uuid(), $selectedUuids));
    if (empty($cfdisToDownload)) Response::json(['error' => 'No se encontraron CFDI para descargar.'], 400);

    // descarga todos los seleccionados con concurrencia 50 (lo maneja Guzzle)
    $downloadList = new MetadataList($cfdisToDownload);

    $resultados = $satScraper->resourceDownloader($resourceType, $downloadList)
        ->setConcurrency(30) // Puedes ajustar el número
        ->saveTo(DESCARGA_PATH, true, 0777);

    $descargados = $resultados;
    $faltantes = array_values(array_diff($selectedUuids, $descargados));

    Response::json([
        'status' => 'OK',
        'msg' => 'Descarga completada.',
        'descargados' => $descargados,
        'noDescargados' => $faltantes,
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
