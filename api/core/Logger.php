<?php
class Logger {
    public static function error($message, $data = null) {
        $logEntry = date('Y-m-d H:i:s') . " - ERROR - $message";
        if ($data) $logEntry .= " - Data: " . json_encode($data);
        error_log($logEntry . PHP_EOL, 3, __DIR__ . '/../error.log');
    }

    public static function info($message, $data = null) {
        $logEntry = date('Y-m-d H:i:s') . " - INFO - $message";
        if ($data) $logEntry .= " - Data: " . json_encode($data);
        error_log($logEntry . PHP_EOL, 3, __DIR__ . '/../error.log');
    }
}
