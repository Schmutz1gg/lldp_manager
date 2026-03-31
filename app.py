import subprocess
import json
import os
import sys
import time
import re
from flask import Flask, jsonify, request, render_template

app = Flask(__name__)

# Путь к конфигурационному файлу
CONFIG_FILE = '/etc/lldpd.d/web.conf'
LLDPCLI_CMD = ['lldpcli']

# Была пробелема с невидимыми символами

ALLOWED_TEXT_PATTERN = re.compile(r'[^a-zA-Z0-9а-яА-ЯёЁ\s\-_.]')
ALLOWED_IP_PATTERN = re.compile(r'[^0-9.:]')

def clean_text(text):
    """Очищает строку от недопустимых символов."""
    if not text:
        return ''
    return ALLOWED_TEXT_PATTERN.sub('', text).strip()

def clean_ip(ip):
    """Очищает IP-адрес от недопустимых символов."""
    if not ip:
        return ''
    return ALLOWED_IP_PATTERN.sub('', ip).strip()

def run_command(cmd, sudo=False):
    """Выполняет команду, с sudo."""
    full_cmd = ['sudo'] + cmd if sudo else cmd
    try:
        result = subprocess.run(full_cmd, capture_output=True, text=True, check=False)
        return result
    except Exception as e:
        app.logger.exception("Command failed")
        return subprocess.CompletedProcess(full_cmd, returncode=1, stdout='', stderr=str(e))

def run_lldpcli(args, sudo=True):
    """Выполняет lldpcli с аргументами, по умолчанию с sudo."""
    return run_command(LLDPCLI_CMD + args, sudo=sudo)

def save_config_to_file(config_dict):
    """Сохраняет конфигурацию в файл в формате команд lldpcli."""
    lines = []
    
    # Статусы LLDP для портов
    if 'ports_status' in config_dict and isinstance(config_dict['ports_status'], dict):
        for port, status in config_dict['ports_status'].items():
            port = clean_text(port)
            if port and status in ('disabled', 'rx-only', 'tx-only', 'rx-and-tx'):
                lines.append(f"configure ports {port} lldp status {status}")

    # Системное имя
    if 'hostname' in config_dict and config_dict['hostname'].strip():
        hostname = clean_text(config_dict['hostname'])
        if hostname:
            lines.append(f"configure system hostname \"{hostname}\"")

    # Системное описание
    if 'description' in config_dict and config_dict['description'].strip():
        desc = clean_text(config_dict['description'])
        if desc:
            lines.append(f"configure system description \"{desc}\"")

    # Адрес управления
    if 'mgmt_address' in config_dict and config_dict['mgmt_address'].strip():
        mgmt = clean_ip(config_dict['mgmt_address'])
        if mgmt:
            lines.append(f"configure system ip management pattern {mgmt}")

    # Интервал отправки
    if 'tx_interval' in config_dict and config_dict['tx_interval']:
        try:
            interval = int(config_dict['tx_interval'])
            if 1 <= interval <= 3600:
                lines.append(f"configure lldp tx-interval {interval}")
        except ValueError:
            pass

    # Описания портов
    if 'ports_description' in config_dict and isinstance(config_dict['ports_description'], dict):
        for port, desc in config_dict['ports_description'].items():
            port = clean_text(port)
            desc = clean_text(desc)
            if port:  # всегда добавляем команду, даже если desc пустой
                lines.append(f"configure ports {port} lldp portdescription \"{desc}\"")

    allowed_caps = {'bridge', 'router', 'wlan', 'station'}
    if 'capabilities' in config_dict and config_dict['capabilities']:
        caps = []
        for c in config_dict['capabilities']:
            if not isinstance(c, str):
                continue
            c = c.strip().lower()
            # удаляем всё, кроме букв
            c = re.sub(r'[^a-z]', '', c)
            if c in allowed_caps:
                caps.append(c)
        if caps:
            lines.append(f"configure system capabilities enabled {','.join(caps)}")

    # Шаблон интерфейсов
    if 'iface_pattern' in config_dict and config_dict['iface_pattern'].strip():
        pattern = clean_text(config_dict['iface_pattern'])
        if pattern:
            lines.append(f"configure system interface pattern {pattern}")

    # Запись в файл
    try:
        with open(CONFIG_FILE, 'w') as f:
            f.write('\n'.join(lines))
            if lines:
                f.write('\n')  # завершающий перевод строки
        return True
    except Exception as e:
        app.logger.error(f"Failed to write config: {e}")
        return False

def restart_lldpd():
    """Перезапускает демон lldpd и проверяет успешность."""
    res = run_command(['systemctl', 'restart', 'lldpd'], sudo=True)
    if res.returncode != 0:
        return False
    time.sleep(2)  # дать время на запуск
    # Проверка статуса
    status = run_command(['systemctl', 'is-active', 'lldpd'], sudo=False)
    return status.returncode == 0

def log_to_syslog(message):
    """Записывает сообщение в syslog."""
    run_command(['logger', '-t', 'lldp-web', message], sudo=False)

def get_current_config():
    """Получает текущую конфигурацию из lldpcli."""
    res = run_lldpcli(['show', 'configuration', '-f', 'json'])
    if res.returncode != 0:
        return {}
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError:
        return {}

def get_neighbors():
    """Получает список соседей."""
    res = run_lldpcli(['show', 'neighbors', 'details', '-f', 'json'])
    if res.returncode != 0:
        return {}
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError:
        return {}

def get_chassis():
    """Получает локальную информацию о chassis."""
    res = run_lldpcli(['show', 'chassis', '-f', 'json'])
    if res.returncode != 0:
        return {}
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError:
        return {}

def get_lldp_interfaces():
    """Получает информацию об интерфейсах LLDP."""
    res = run_lldpcli(['show', 'interfaces', '-f', 'json'])
    if res.returncode != 0:
        return {}
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError:
        return {}

def get_system_interfaces():
    """Возвращает список сетевых интерфейсов из системы."""
    res = run_command(['ip', '-br', 'link'], sudo=False)
    if res.returncode != 0:
        return []
    interfaces = []
    for line in res.stdout.strip().split('\n'):
        parts = line.split()
        if len(parts) >= 2 and parts[1] == 'UP':
            interfaces.append(parts[0])
    return interfaces

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/neighbors')
def api_neighbors():
    data = get_neighbors()
    return jsonify(data)

@app.route('/api/config')
def api_config():
    data = get_current_config()
    return jsonify(data)

@app.route('/api/chassis')
def api_chassis():
    data = get_chassis()
    return jsonify(data)

@app.route('/api/lldp-interfaces')
def api_lldp_interfaces():
    data = get_lldp_interfaces()
    return jsonify(data)

@app.route('/api/interfaces')
def api_system_interfaces():
    return jsonify({'interfaces': get_system_interfaces()})

@app.route('/api/configure', methods=['POST'])
def api_configure():
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    # Обработка статусов портов
    ports_status = data.get('ports_status', {})
    if not isinstance(ports_status, dict):
        ports_status = {}
    clean_ports_status = {}
    for port, status in ports_status.items():
        port = clean_text(port)
        if port and status in ('disabled', 'rx-only', 'tx-only', 'rx-and-tx'):
            clean_ports_status[port] = status
    data['ports_status'] = clean_ports_status

    # Обработка описаний портов
    ports_description = data.get('ports_description', {})
    if not isinstance(ports_description, dict):
        ports_description = {}
    clean_ports_desc = {}
    for port, desc in ports_description.items():
        port = clean_text(port)
        desc = clean_text(desc)
        if port:
            clean_ports_desc[port] = desc
    data['ports_description'] = clean_ports_desc

    if save_config_to_file(data):
        if restart_lldpd():
            log_to_syslog(f"Configuration updated: {json.dumps(data)}")
            return jsonify({'status': 'ok'})
        else:
            return jsonify({'error': 'lldpd failed to restart. Check config.'}), 500
    else:
        return jsonify({'error': 'Failed to write config file'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
