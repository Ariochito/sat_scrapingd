<?php
define('CONFIGS_FILE', __DIR__ . '/../storage/boxfactura-model/configs.yaml');
define('MAX_VISUAL', 2000);
define('DESCARGA_PATH', __DIR__ . '/../descarga');

// Configuraciones del sistema de descarga robusto
define('DEFAULT_CHUNK_SIZE', 30);
define('DEFAULT_MAX_RETRIES', 5);
define('DEFAULT_INITIAL_DELAY', 2000); // ms
define('MAX_CHUNK_SIZE', 100);
define('MIN_CHUNK_SIZE', 10);
define('MAX_RETRIES_LIMIT', 20);
define('RETRY_CHUNK_SIZE', 20); // Tamaño reducido para reintentos
define('RETRY_MAX_RETRIES', 8); // Más reintentos para archivos problemáticos
define('RETRY_INITIAL_DELAY', 3000); // ms - delay más largo para reintentos
