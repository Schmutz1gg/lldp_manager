let rawChassisData = null;
let rawInterfacesData = null;
let rawConfigData = null;
let rawNeighborsData = null;
let statusTimeout = null;
let network = null;

function loadPortsControls() {
    fetch('/api/interfaces')
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById('ports-status-container');
            container.innerHTML = '';
            if (!data.interfaces || data.interfaces.length === 0) {
                container.innerHTML = '<div>No active interfaces found</div>';
                return;
            }
            fetch('/api/lldp-interfaces')
                .then(res => res.json())
                .then(statusData => {
                    console.log("Ports status raw data:", statusData);
                    let interfaces = statusData?.lldp?.interface;
                    let portStatusMap = {};
                    let portDescMap = {};
                    if (interfaces) {
                        let interfacesArray = Array.isArray(interfaces) ? interfaces : [interfaces];
                        interfacesArray.forEach(entry => {
                            Object.keys(entry).forEach(port => {
                                const info = entry[port];
                                const status = info?.status || '';
                                let mappedStatus = '';
                                if (status.includes('RX') && status.includes('TX')) mappedStatus = 'rx-and-tx';
                                else if (status.includes('RX')) mappedStatus = 'rx-only';
                                else if (status.includes('TX')) mappedStatus = 'tx-only';
                                else mappedStatus = 'disabled';
                                portStatusMap[port] = mappedStatus;
                                portDescMap[port] = info?.port?.descr || '';
                            });
                        });
                    }
                    data.interfaces.forEach(iface => {
                        const div = document.createElement('div');
                        div.style.marginBottom = '10px';
                        div.style.padding = '5px';
                        div.style.borderBottom = '1px solid #ddd';
                        const label = document.createElement('span');
                        label.textContent = iface + ': ';
                        label.style.fontWeight = 'bold';
                        label.style.display = 'inline-block';
                        label.style.width = '100px';
                        
                        const statusSelect = document.createElement('select');
                        statusSelect.id = `port_status_${iface}`;
                        statusSelect.name = `port_status_${iface}`;
                        statusSelect.style.marginRight = '15px';
                        const options = [
                            { value: 'disabled', text: 'Disabled' },
                            { value: 'rx-only', text: 'RX only' },
                            { value: 'tx-only', text: 'TX only' },
                            { value: 'rx-and-tx', text: 'RX and TX' }
                        ];
                        options.forEach(opt => {
                            const option = document.createElement('option');
                            option.value = opt.value;
                            option.textContent = opt.text;
                            if (portStatusMap[iface] === opt.value) option.selected = true;
                            statusSelect.appendChild(option);
                        });
                        
                        const descInput = document.createElement('input');
                        descInput.type = 'text';
                        descInput.id = `port_desc_${iface}`;
                        descInput.name = `port_desc_${iface}`;
                        descInput.placeholder = 'Port description';
                        descInput.style.width = '250px';
                        descInput.value = portDescMap[iface] || '';
                        
                        div.appendChild(label);
                        div.appendChild(statusSelect);
                        div.appendChild(document.createTextNode(' Description: '));
                        div.appendChild(descInput);
                        container.appendChild(div);
                    });
                })
                .catch(err => console.error('Error loading LLDP data:', err));
        })
        .catch(error => console.error('Error loading interfaces:', error));
}

function loadLocalInfo() {
    fetch('/api/chassis')
        .then(response => response.json())
        .then(data => {
            rawChassisData = data;
            const chassis = data['local-chassis']?.chassis;
            if (chassis) {
                let html = '<table><tr><th>Parameter</th><th>Value</th></tr><tbody>';
                for (let key in chassis) {
                    const item = chassis[key];
                    html += `<tr><td>Chassis ID</td><td>${item.id.type} ${item.id.value}</td></tr>`;
                    html += `<tr><td>System Name</td><td>${key}</td></tr>`;
                    html += `<tr><td>System Description</td><td>${item.descr}</td></tr>`;
                    html += `<tr><td>Management IP</td><td>${item['mgmt-ip'].join(', ')}</td></tr>`;
                    html += `<tr><td>Capabilities</td><td>${item.capability.map(c => `${c.type}:${c.enabled ? ' on' : ' off'}`).join('<br>')}</td></tr>`;
                }
                html += '</tbody></table>';
                document.getElementById('local-info-container').innerHTML = html;
            } else {
                document.getElementById('local-info-container').innerHTML = 'No data';
            }
            document.getElementById('local-json').textContent = JSON.stringify(data, null, 2);
        })
        .catch(error => {
            console.error('Error loading local info:', error);
            document.getElementById('local-info-container').innerHTML = 'Error loading data';
        });
}

function loadPortsInfo(retries = 2, delay = 500) {
    fetch('/api/lldp-interfaces')
        .then(response => response.json())
        .then(data => {
            console.log("Ports info raw data:", data);
            rawInterfacesData = data;
            let interfaces = data?.lldp?.interface;
            if (!interfaces) {
                if (retries > 0) {
                    setTimeout(() => loadPortsInfo(retries - 1, delay), delay);
                    return;
                }
                document.getElementById('ports-info-container').innerHTML = 'No ports data (missing lldp.interface)';
                return;
            }
            let interfacesArray = Array.isArray(interfaces) ? interfaces : [interfaces];
            if (interfacesArray.length === 0 && retries > 0) {
                setTimeout(() => loadPortsInfo(retries - 1, delay), delay);
                return;
            }
            if (interfacesArray.length === 0) {
                document.getElementById('ports-info-container').innerHTML = 'No ports data';
                return;
            }
            let html = '<table><tr><th>Port</th><th>Port ID</th><th>Description</th><th>LLDP Status</th></tr>';
            interfacesArray.forEach(entry => {
                Object.keys(entry).forEach(portName => {
                    const info = entry[portName];
                    if (info && typeof info === 'object') {
                        const portId = info.port?.id?.value || 'unknown';
                        const description = info.port?.descr || '';
                        const status = info.status || 'unknown';
                        html += `<tr><td>${portName}</td><td>${portId}</td><td>${description}</td><td>${status}</td></tr>`;
                    }
                });
            });
            html += '</table>';
            document.getElementById('ports-info-container').innerHTML = html;
            document.getElementById('ports-json').textContent = JSON.stringify(data, null, 2);
        })
        .catch(error => {
            console.error('Error loading ports info:', error);
            if (retries > 0) {
                setTimeout(() => loadPortsInfo(retries - 1, delay), delay);
            } else {
                document.getElementById('ports-info-container').innerHTML = 'Error loading data: ' + error;
            }
        });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
        return c;
    });
}

// Функция создания таблицы полной конфигурации текущего устройства
function renderConfigTable(config) {
    if (!config || Object.keys(config).length === 0) {
        return '<p>No configuration data</p>';
    }
    let html = '<table class="config-table" style="width: 100%; table-layout: fixed;"><thead><tr><th style="width: 30%;">Property</th><th style="width: 70%;">Value</th></tr></thead><tbody>';
    for (let key in config) {
        let value = config[key];
        let displayValue = (typeof value === 'object') ? JSON.stringify(value, null, 2) : String(value);
        html += `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(displayValue)}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function loadConfig() {
    fetch('/api/config')
        .then(response => response.json())
        .then(data => {
            rawConfigData = data;
            document.getElementById('configTableContainer').innerHTML = renderConfigTable(data.configuration.config);
            document.getElementById('config-json').textContent = JSON.stringify(data, null, 2);
            const cfg = data.configuration?.config;
            if (cfg) {
                if (cfg.hostname && cfg.hostname !== '(none)') {
                    document.getElementById('hostname').value = cfg.hostname;
                }
                if (cfg.description && cfg.description !== '(none)') {
                    document.getElementById('description').value = cfg.description;
                }
                if (cfg.tx_delay) {
                    document.getElementById('tx_interval').value = cfg.tx_delay;
                }
                if (cfg.iface_pattern && cfg.iface_pattern !== '(none)') {
                    document.getElementById('iface_pattern').value = cfg.iface_pattern;
                }
                if (cfg.capabilities && cfg.capabilities !== 'no') {
                    const caps = cfg.capabilities.split(',');
                    document.querySelectorAll('.capabilities input').forEach(cb => {
                        cb.checked = caps.includes(cb.value);
                    });
                }
            }
        })
        .catch(error => {
            console.error('Error loading config:', error);
            document.getElementById('configTableContainer').innerHTML = '<p>Error loading config: ' + escapeHtml(error) + '</p>';
        });
}

function loadNeighbors() {
    fetch('/api/neighbors')
        .then(response => response.json())
        .then(data => {
            rawNeighborsData = data;
            console.log("Neighbors data loaded:", rawNeighborsData);
            document.getElementById('neighborsDisplay').textContent = JSON.stringify(data, null, 2);
            document.getElementById('neighbors-json').textContent = JSON.stringify(data, null, 2);
            if (document.getElementById('graphContainer').style.display === 'block') {
                buildTopologyGraph();
            }
        })
        .catch(error => {
            console.error('Error loading neighbors:', error);
            document.getElementById('neighborsDisplay').textContent = 'Error loading neighbors: ' + error;
        });
}

function buildTopologyGraph() {
    console.log("Building graph, rawNeighborsData:", rawNeighborsData);
    if (!rawNeighborsData) {
        document.getElementById('graphContainer').innerHTML = '<div style="padding:20px; text-align:center;">No neighbor data loaded yet.</div>';
        return;
    }
    let interfaces = rawNeighborsData?.lldp?.interface;
    if (!interfaces) {
        console.error("Missing lldp.interface in rawNeighborsData");
        document.getElementById('graphContainer').innerHTML = '<div style="padding:20px; text-align:center;">Invalid neighbor data structure.</div>';
        return;
    }
    // Толи массив, то ли объект не пойму
    if (!Array.isArray(interfaces)) {
        console.warn("interfaces is not an array, converting to array");
        interfaces = [interfaces];
    }
    if (interfaces.length === 0) {
        document.getElementById('graphContainer').innerHTML = '<div style="padding:20px; text-align:center;">No neighbor data (empty array).</div>';
        return;
    }

    let hasNeighbors = false;
    for (let ifaceItem of interfaces) {
        for (let portName in ifaceItem) {
            const neighborData = ifaceItem[portName];
            if (neighborData?.chassis && neighborData.chassis.id?.type !== 'local') {
                hasNeighbors = true;
                break;
            }
        }
    }
    if (!hasNeighbors) {
        document.getElementById('graphContainer').innerHTML = '<div style="padding:20px; text-align:center;">No neighbors discovered</div>';
        return;
    }

    const nodes = [];
    const edges = [];
    const nodeIds = new Set();
    let localNodeId = "local";
    let localLabel = "Local Device";
    if (rawChassisData && rawChassisData['local-chassis']?.chassis) {
        const chassisObj = rawChassisData['local-chassis'].chassis;
        for (let name in chassisObj) {
            localLabel = name || localLabel;
            break;
        }
    }
    nodes.push({
        id: localNodeId,
        label: localLabel,
        shape: 'box',
        color: { background: '#97c2fc', border: '#2B6CE4' },
        title: "Local Device"
    });
    nodeIds.add(localNodeId);

    interfaces.forEach(ifaceItem => {
        for (let portName in ifaceItem) {
            const neighborData = ifaceItem[portName];
            if (!neighborData?.chassis) continue;
            if (neighborData.chassis.id?.type === 'local') continue;
            let remoteId = null;
            let remoteLabel = null;
            if (neighborData.chassis.HiOS_PRP_1stSwitch) {
                remoteId = neighborData.chassis.HiOS_PRP_1stSwitch.id.value;
                remoteLabel = "HiOS_PRP_1stSwitch";
            } else if (neighborData.chassis.id) {
                remoteId = neighborData.chassis.id.value;
                remoteLabel = neighborData.chassis.name || remoteId.substring(0, 8);
            } else {
                const keys = Object.keys(neighborData.chassis).filter(k => k !== 'id');
                if (keys.length) {
                    remoteId = neighborData.chassis[keys[0]]?.id?.value;
                    remoteLabel = keys[0];
                }
            }
            if (!remoteId) return;
            if (!nodeIds.has(remoteId)) {
                nodeIds.add(remoteId);
                let title = `Chassis: ${remoteId}\n`;
                let mgmtIp = neighborData.chassis.mgmt || neighborData.chassis.HiOS_PRP_1stSwitch?.mgmt;
                if (mgmtIp) title += `IP: ${mgmtIp}\n`;
                nodes.push({ id: remoteId, label: remoteLabel, title: title, shape: 'dot' });
            }
            const remotePort = neighborData.port?.id?.value || neighborData.port?.descr || '?';
            edges.push({
                from: localNodeId,
                to: remoteId,
                label: `${portName} → ${remotePort}`,
                arrows: 'to',
                title: `Local port: ${portName}\nRemote port: ${remotePort}`
            });
        }
    });

    if (edges.length === 0) {
        document.getElementById('graphContainer').innerHTML = '<div style="padding:20px; text-align:center;">No valid neighbors after filtering</div>';
        return;
    }

    const container = document.getElementById('graphContainer');
    container.innerHTML = '';
    const graphData = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
    const options = {
        nodes: { shape: 'dot', size: 20, font: { size: 12 } },
        edges: { smooth: true, font: { align: 'top' } },
        physics: { stabilization: true, enabled: true }
    };
    network = new vis.Network(container, graphData, options);
}

document.getElementById('toggleGraphBtn').addEventListener('click', function() {
    const container = document.getElementById('graphContainer');
    if (container.style.display === 'none') {
        container.style.display = 'block';
        this.textContent = 'Hide Graph';
        buildTopologyGraph();
    } else {
        container.style.display = 'none';
        this.textContent = 'Show Graph';
        if (network) network.destroy();
    }
});

document.querySelectorAll('.json-button').forEach(button => {
    button.addEventListener('click', function() {
        const targetId = this.getAttribute('data-target');
        const jsonElement = document.getElementById(targetId);
        if (jsonElement.style.display === 'none' || jsonElement.style.display === '') {
            jsonElement.style.display = 'block';
            this.textContent = 'Hide JSON';
        } else {
            jsonElement.style.display = 'none';
            this.textContent = 'Show JSON';
        }
    });
});

document.getElementById('configForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const ports_status = {};
    const ports_description = {};
    document.querySelectorAll('#ports-status-container select').forEach(select => {
        const port = select.id.replace('port_status_', '');
        ports_status[port] = select.value;
    });
    document.querySelectorAll('#ports-status-container input[type="text"]').forEach(input => {
        const port = input.id.replace('port_desc_', '');
        ports_description[port] = input.value;
    });
    const iface_pattern = document.getElementById('iface_pattern').value;
    const hostname = document.getElementById('hostname').value;
    const description = document.getElementById('description').value;
    const mgmt_address = document.getElementById('mgmt_address').value;
    const tx_interval = document.getElementById('tx_interval').value;
    const capabilities = Array.from(document.querySelectorAll('.capabilities input:checked')).map(cb => cb.value);
    const payload = {
        ports_status, ports_description, iface_pattern, hostname,
        description, mgmt_address, tx_interval, capabilities
    };
    const statusDiv = document.getElementById('configStatus');
    statusDiv.textContent = 'Applying configuration...';
    statusDiv.className = 'loading';
    fetch('/api/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'ok') {
            statusDiv.textContent = 'Configuration applied successfully.';
            statusDiv.className = 'success';
            if (statusTimeout) clearTimeout(statusTimeout);
            statusTimeout = setTimeout(() => { statusDiv.textContent = ''; }, 5000);
            setTimeout(() => {
                loadConfig();
                loadNeighbors();
                loadLocalInfo();
                loadPortsInfo();
                if (document.getElementById('graphContainer').style.display === 'block') {
                    buildTopologyGraph();
                }
            }, 1500);
        } else {
            statusDiv.textContent = 'Error: ' + JSON.stringify(data);
            statusDiv.className = 'error';
        }
    })
    .catch(error => {
        statusDiv.textContent = 'Error: ' + error;
        statusDiv.className = 'error';
    });
});

loadConfig();
loadNeighbors();
loadLocalInfo();
loadPortsInfo();
loadPortsControls();
setInterval(loadNeighbors, 30000); // Загружаю соседей каждые 30 сек, если до этого небыло reload