<?php
class Logger {
    public static function error($message, $data = null) {
        $logEntry = date('Y-m-d H:i:s') . " - $message";
        if ($data) $logEntry .= " - Data: " . json_encode($data);
        error_log($logEntry, 3, __DIR__ . '/../error.log');
    }
}
