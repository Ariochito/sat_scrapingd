<?php
use PhpCfdi\ImageCaptchaResolver\BoxFacturaAI\BoxFacturaAIResolver;
use PhpCfdi\CfdiSatScraper\Sessions\Ciec\CiecSessionManager;
use PhpCfdi\CfdiSatScraper\SatScraper;

class AuthController {
    public static function login($data) {
        $rfc = trim($data['rfc'] ?? '');
        $ciec = trim($data['ciec'] ?? '');
        if (!$rfc || !$ciec) Response::json(['error' => 'Falta RFC o CIEC'], 400);
        if (!file_exists(CONFIGS_FILE)) Response::json(['error' => 'No se encuentra el archivo de configuración'], 500);

        try {
            $captchaResolver = BoxFacturaAIResolver::createFromConfigs(CONFIGS_FILE);
            $sessionManager = CiecSessionManager::create($rfc, $ciec, $captchaResolver);
            $satScraper = new SatScraper($sessionManager);
            $satScraper->confirmSessionIsAlive();

            $_SESSION['sat'][$rfc] = ['rfc'=>$rfc, 'ciec'=>$ciec, 'login_time'=>time()];
            Response::json(['success'=>true, 'msg'=>"Sesión SAT activa para $rfc"]);
        } catch (Throwable $e) {
            Logger::error("Login failed", ['error'=>$e->getMessage()]);
            Response::json(['error'=>"Login SAT fallido: ".$e->getMessage()], 401);
        }
    }

    public static function logout($data) {
        $rfc = trim($data['rfc'] ?? '');
        if ($rfc && isset($_SESSION['sat'][$rfc])) unset($_SESSION['sat'][$rfc]);
        Response::json(['success'=>true, 'msg'=>'Sesión SAT cerrada']);
    }

    public static function status($data) {
        $rfc = trim($data['rfc'] ?? '');
        if ($rfc && isset($_SESSION['sat'][$rfc])) {
            Response::json([
                'active'=>true, 'msg'=>"Sesión activa para $rfc", 'rfc'=>$rfc,
                'login_time'=>$_SESSION['sat'][$rfc]['login_time'],
            ]);
        }
        Response::json(['active'=>false, 'msg'=>'No hay sesión SAT activa para ese RFC.']);
    }
}
