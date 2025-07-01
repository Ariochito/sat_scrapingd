<?php
class Response {
    public static function json($arr, $status=200) {
        http_response_code($status);
        echo json_encode($arr);
        exit;
    }
}
