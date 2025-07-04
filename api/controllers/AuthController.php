<?php

use PhpCfdi\ImageCaptchaResolver\BoxFacturaAI\BoxFacturaAIResolver;
use PhpCfdi\CfdiSatScraper\Sessions\Ciec\CiecSessionData;
use PhpCfdi\CfdiSatScraper\Sessions\Ciec\CiecSessionManager;
use PhpCfdi\CfdiSatScraper\SatScraper;
use GuzzleHttp\Cookie\FileCookieJar;

class AuthController
{
    public static function login($data)
    {
        $rfc = trim($data['rfc'] ?? '');
        $ciec = trim($data['ciec'] ?? '');
        if (!$rfc || !$ciec) Response::json(['error' => 'Falta RFC o CIEC'], 400);
        if (!file_exists(CONFIGS_FILE)) Response::json(['error' => 'No se encuentra el archivo de configuración'], 500);

        try {
            $captchaResolver = BoxFacturaAIResolver::createFromConfigs(CONFIGS_FILE);

            // Ruta correcta para cookies
            if (!is_dir(SAT_SESSIONS_PATH)) {
                mkdir(SAT_SESSIONS_PATH, 0775, true);
            }
            $cookieFile = SAT_SESSIONS_PATH . 'sat_session_' . $rfc . '.cookie';


            // Usa el método create para persistencia de sesión
            $sessionManager = CiecSessionManager::create($rfc, $ciec, $captchaResolver, $cookieFile);
            $satScraper = new SatScraper($sessionManager);

            try {
                $satScraper->confirmSessionIsAlive();
            } catch (\Throwable $e) {
                $sessionManager->login();
            }


            $_SESSION['sat'][$rfc] = [
                'rfc' => $rfc,
                'ciec' => $ciec,
                'login_time' => time()
            ];

            Response::json(['success' => true, 'msg' => "Sesión SAT activa para $rfc"]);
        } catch (\Throwable $e) {
            Logger::error("Login failed", ['error' => $e->getMessage()]);
            Response::json(['error' => "Login SAT fallido: " . $e->getMessage()], 401);
        }
    }


    public static function logout($data)
    {
        $rfc = trim($data['rfc'] ?? '');
        // Elimina de sesión PHP:
        if ($rfc && isset($_SESSION['sat'][$rfc])) unset($_SESSION['sat'][$rfc]);
        // Elimina el archivo de cookies SAT:
        $sessionPath = SAT_SESSIONS_PATH;
        $cookieFile = SAT_SESSIONS_PATH . 'sat_session_' . $rfc . '.cookie';
        if (file_exists($cookieFile)) {
            unlink($cookieFile);
        }
        Response::json(['success' => true, 'msg' => 'Sesión SAT cerrada']);
    }

    public static function status($data)
    {
        $rfc = trim($data['rfc'] ?? '');
        if ($rfc && isset($_SESSION['sat'][$rfc])) {
            Response::json([
                'active' => true,
                'msg' => "Sesión activa para $rfc",
                'rfc' => $rfc,
                'login_time' => $_SESSION['sat'][$rfc]['login_time'],
            ]);
        }
        Response::json(['active' => false, 'msg' => 'No hay sesión SAT activa para ese RFC.']);
    }
}
