<?php

use PhpCfdi\CfdiSatScraper\Filters\DownloadType;
use PhpCfdi\CfdiSatScraper\Filters\Options\StatesVoucherOption;
use PhpCfdi\CfdiSatScraper\Filters\Options\ComplementsOption;
use PhpCfdi\CfdiSatScraper\Filters\Options\RfcOption;
use PhpCfdi\CfdiSatScraper\Filters\Options\RfcOnBehalfOption;
use PhpCfdi\CfdiSatScraper\QueryByFilters;

class FiltersHelper
{
    public static function get($data)
    {
        $tipo = $data['tipo'] ?? 'emitidas';
        $fechaInicio = $fechaFin = '';
        if ($tipo === 'emitidas') {
            $fechaInicio = $data['fechaInicio'] ?? '';
            $fechaFin = $data['fechaFin'] ?? ''; {
                if (!$fechaInicio || !$fechaFin) Response::json(['error' => 'Indica fecha inicio y fin para emitidos'], 400);
            }

            $dtInicio = new DateTimeImmutable($fechaInicio);
            $dtFin = new DateTimeImmutable($fechaFin);
            $dias = $dtInicio->diff($dtFin)->days;
            if ($dias > 365) {
                Response::json(['error' => 'El rango de fechas para emitidas no debe ser mayor a 1 año (365 días).'], 400);
            }
        } else {
            $mes = $data['mesPeriodo'] ?? '';
            $anio = $data['anioPeriodo'] ?? '';
            if (!$mes || !$anio) Response::json(['error' => 'Indica mes y año para recibidos'], 400);
            $fechaInicio = "$anio-$mes-01";
            $fechaFin = (new DateTimeImmutable($fechaInicio))->modify('last day of this month')->format('Y-m-d');
        }
        $estado = $data['estado'] ?? '';
        $complemento = $data['complemento'] ?? '';
        $rfcFiltro = trim($data['rfcFiltro'] ?? '');
        $rfcTerceros = trim($data['rfcTerceros'] ?? '');
        $downloadType = $data['downloadType'] ?? 'xml';
        return compact('tipo', 'fechaInicio', 'fechaFin', 'estado', 'complemento', 'rfcFiltro', 'rfcTerceros', 'downloadType');
    }

    public static function buildQuery($filtros)
    {
        extract($filtros);
        $query = new QueryByFilters(new DateTimeImmutable($fechaInicio), new DateTimeImmutable($fechaFin));
        $query->setDownloadType($tipo === 'recibidas' ? DownloadType::recibidos() : DownloadType::emitidos());
        if ($estado === "vigente") $query->setStateVoucher(StatesVoucherOption::vigentes());
        if ($estado === "cancelado") $query->setStateVoucher(StatesVoucherOption::cancelados());
        if (strtolower($complemento) === "nomina") $query->setComplement(ComplementsOption::nomina12());
        if (strtolower($complemento) === "pagos") $query->setComplement(ComplementsOption::pagos20());
        if ($rfcFiltro) $query->setRfc(new RfcOption($rfcFiltro));
        if ($rfcTerceros) $query->setRfcOnBehalf(new RfcOnBehalfOption($rfcTerceros));
        return $query;
    }
}
