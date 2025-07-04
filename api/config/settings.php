<?php
define('CONFIGS_FILE', __DIR__ . '/../storage/boxfactura-model/configs.yaml');
define('MAX_VISUAL', 2000);
define('DESCARGA_PATH', __DIR__ . '/../descarga');
define('SAT_SESSIONS_PATH', __DIR__ . '/../storage/sat_sessions/');


// Configuraciones del sistema de descarga robusto
define('DEFAULT_CHUNK_SIZE', 50);
define('DEFAULT_MAX_RETRIES', 3);
define('DEFAULT_INITIAL_DELAY', 5000); // ms
define('MAX_CHUNK_SIZE', 200);
define('MIN_CHUNK_SIZE', 10);
define('MAX_RETRIES_LIMIT', 5);
define('RETRY_CHUNK_SIZE', 20); // Tamaño reducido para reintentos
define('RETRY_MAX_RETRIES', 8); // Más reintentos para archivos problemáticos
define('RETRY_INITIAL_DELAY', 5000); // ms - delay más largo para reintentos
