<?php
header('Content-Type: application/json');

$info = [
    'server_type' => 'PHP',
    'php_version' => phpversion(),
    'node_js_available' => false,
    'ssh_available' => false,
    'file_permissions' => [],
    'extensions' => get_loaded_extensions()
];

// Check if we can execute shell commands
if (function_exists('shell_exec')) {
    $info['shell_exec_available'] = true;
    $info['node_js_available'] = !empty(shell_exec('which node 2>/dev/null'));
} else {
    $info['shell_exec_available'] = false;
}

// Check file permissions
$info['file_permissions'] = [
    'current_dir_writable' => is_writable('.'),
    'current_dir_readable' => is_readable('.'),
    'can_create_files' => @file_put_contents('test_write.txt', 'test') !== false
];

// Clean up test file
@unlink('test_write.txt');

echo json_encode($info, JSON_PRETTY_PRINT);
?> 