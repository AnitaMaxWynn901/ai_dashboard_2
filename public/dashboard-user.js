document.addEventListener("DOMContentLoaded", () => {
    let map;
    let markers = {};
    let hasFittedMap = false;
    let boxLocationMap = {};
    let boxMetaMap = {};
    let filterApplied = false;

    let appliedFilters = {
        type: "ALL",
        boxCode: "",
        from: "",
        to: "",
        status: "all"
    };

    async function loadCurrentUser() {
        try {
            const res = await fetch("/me");

            if (!res.ok) {
                window.location.href = "/login.html";
                return null;
            }

            const data = await res.json();
            return data.user;
        } catch (err) {
            window.location.href = "/login.html";
            return null;
        }
    }

    async function logout() {
        try {
            await fetch("/logout", { method: "POST" });
        } catch (err) {
            console.error("Logout failed:", err);
        }
        window.location.href = "/login.html";
    }

    function initMap() {
        map = L.map("map").setView([13.7563, 100.5018], 6);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors"
        }).addTo(map);
    }

    async function loadBoxMeta() {
        try {
            const res = await fetch("/box-meta");
            const data = await res.json();

            boxMetaMap = {};

            data.forEach(item => {
                boxMetaMap[item.boxCode] = {
                    boxName: item.boxName || "",
                    deviceName: item.deviceName || ""
                };
            });
        } catch (err) {
            console.error("Failed to load box meta:", err);
        }
    }

    async function loadLocations() {
        try {
            const res = await fetch("/locations");
            const data = await res.json();

            if (!Array.isArray(data) || data.length === 0) {
                return;
            }

            boxLocationMap = {};

            data.forEach(loc => {
                boxLocationMap[loc.boxCode] = {
                    lat: loc.lat,
                    lng: loc.lng
                };
            });

        } catch (err) {
            console.error("Failed to load locations:", err);
        }
    }

    function getMarkerColor(aiStatus, nodeStatus) {
        if (aiStatus === "online" && nodeStatus === "online") return "green";
        if (aiStatus === "offline" && nodeStatus === "offline") return "red";
        return "orange";
    }

    function updateMapMarkers(rows) {
        const bounds = [];

        rows.forEach(row => {
            const location = boxLocationMap[row.site];
            if (!location) return;

            const color = getMarkerColor(row.aiBoxStatus, row.nodeStatus);

            const popupContent = `
                <b>${boxMetaMap[row.site]?.boxName || row.site}</b><br>
                AI Box: <span class="${row.aiBoxStatus === "online" ? "status-online" : "status-offline"}">
                    ${row.aiBoxStatus}
                </span><br>
                Node-RED: <span class="${row.nodeStatus === "online" ? "status-online" : "status-offline"}">
                    ${row.nodeStatus}
                </span>
            `;

            if (markers[row.site]) {
                markers[row.site].setLatLng([location.lat, location.lng]);
                markers[row.site].setStyle({ fillColor: color });
                markers[row.site].setPopupContent(popupContent);
            } else {
                const marker = L.circleMarker([location.lat, location.lng], {
                    radius: 10,
                    fillColor: color,
                    color: "#000",
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                }).addTo(map);

                marker.bindPopup(popupContent, { autoPan: false });
                markers[row.site] = marker;
            }

            bounds.push([location.lat, location.lng]);
        });

        if (bounds.length > 0 && !hasFittedMap) {
            map.fitBounds(bounds, { padding: [40, 40] });
            hasFittedMap = true;
        }
    }

    function findBoxOnMap() {
        const boxCode = document.getElementById("searchBox").value;

        if (!boxCode) return;

        if (boxCode === "ALL") {
            const bounds = [];

            Object.values(markers).forEach(marker => {
                bounds.push(marker.getLatLng());
            });

            if (bounds.length > 0) {
                map.fitBounds(bounds, { padding: [40, 40] });
            }
            return;
        }

        const marker = markers[boxCode];

        if (!marker) {
            alert("This box does not have a saved location yet.");
            return;
        }

        map.flyTo(marker.getLatLng(), 16, {
            animate: true,
            duration: 0.8
        });
        marker.openPopup();
    }

    function parseTS(ts) {
        const [d, t] = ts.split(" ");
        const [day, mon, yr] = d.split("/");
        return new Date(`${yr}-${mon}-${day}T${t}`);
    }

    function formatDuration(ms) {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h) return `${h}h ${m % 60}m`;
        if (m) return `${m}m ${s % 60}s`;
        return `${s}s`;
    }

    function setDefaultFromDate() {
        const input = document.getElementById("fromFilter");
        const now = new Date();

        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");

        input.value = `${yyyy}-${mm}-${dd}T00:00`;
    }

    async function loadFilters() {
        try {
            const res = await fetch("/filters");
            const data = await res.json();

            const boxSelect = document.getElementById("boxCodeFilter");
            const searchSelect = document.getElementById("searchBox");

            boxSelect.innerHTML = '<option value="">All Box Codes</option>';
            searchSelect.innerHTML = `
                <option value="">Select Box</option>
                <option value="ALL">All Boxes</option>
            `;

            data.boxCodes.forEach(code => {
                if (code) {
                    const displayName = boxMetaMap[code]?.boxName || code;

                    boxSelect.innerHTML += `
                        <option value="${code}">
                            ${displayName}
                        </option>
                    `;

                    searchSelect.innerHTML += `
                        <option value="${code}">
                            ${displayName}
                        </option>
                    `;
                }
            });

        } catch (err) {
            console.error("Failed to load filters:", err);
        }
    }

    async function loadLogs(showAll = false) {
        const { type, boxCode, from, to, status } = appliedFilters;

        const res = await fetch(
            `/logs?type=${type}&boxCode=${boxCode}&from=${from}&to=${to}&status=${status}`
        );
        let logs = await res.json();

        logs = logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (
            !showAll &&
            type === "ALL" &&
            !boxCode &&
            !from &&
            !to &&
            status === "all"
        ) {
            logs = logs.slice(0, 5);
        }

        const normalize = (ts) => {
            const [date, time] = ts.split(" ");
            const [day, month, year] = date.split("/");
            return new Date(`${year}-${month}-${day}T${time}`);
        };

        let html = "";
        let totalOnlineMs = 0;
        let totalOfflineMs = 0;

        for (let i = 0; i < logs.length; i++) {
            const current = logs[i];
            const currentTime = normalize(current.timestamp)?.getTime();
            let duration = "-";

            if (currentTime) {
                let nextTime = null;

                for (let j = i - 1; j >= 0; j--) {
                    if (
                        logs[j].boxCode === current.boxCode &&
                        logs[j].source === current.source
                    ) {
                        nextTime = normalize(logs[j].timestamp)?.getTime();
                        break;
                    }
                }

                let durationMs = 0;

                if (nextTime && nextTime > currentTime) {
                    durationMs = nextTime - currentTime;
                    duration = formatDuration(durationMs);
                } else {
                    durationMs = Math.max(0, Date.now() - currentTime);
                    duration = formatDuration(durationMs);
                }

                if (current.online_status === "online") {
                    totalOnlineMs += durationMs;
                } else if (current.online_status === "offline") {
                    totalOfflineMs += durationMs;
                }
            }

            html += `
                <tr>
                    <td>${boxMetaMap[current.boxCode]?.boxName || current.boxCode}</td>
                    <td>${current.source}</td>
                    <td class="${current.online_status}">
                        ${current.online_status}
                    </td>
                    <td>${current.timestamp}</td>
                    <td>${duration}</td>
                </tr>
            `;
        }

        const totalRows = html ? html.split("<tr>").length - 1 : 0;
        const totalDurationMs = totalOnlineMs + totalOfflineMs;

        document.getElementById("totalRows").innerText = totalRows;
        document.getElementById("totalDuration").innerText = formatDuration(totalDurationMs);
        document.getElementById("logTable").innerHTML = html;

        const title = document.getElementById("totalRowsTitle");

        if (appliedFilters.status === "online") {
            title.innerText = "Total Online";
            title.style.color = "#16a34a";
        } else if (appliedFilters.status === "offline") {
            title.innerText = "Total Offline";
            title.style.color = "#dc2626";
        } else {
            title.innerText = "Total";
            title.style.color = "";
        }
    }

    async function loadLiveStatus() {
        try {
            const res = await fetch("/boxes");
            const data = await res.json();

            const rows = data.boxes || [];
            updateMapMarkers(rows);

            const summary = data.summary || {
                ai: { total: 0, online: 0, offline: 0 },
                node: { total: 0, online: 0, offline: 0 }
            };

            document.getElementById("liveTable").innerHTML =
                rows.map((row, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${boxMetaMap[row.site]?.boxName || row.site}</td>

                        <td class="${row.aiBoxStatus || "offline"}">
                            ${row.aiBoxStatus || "offline"}
                        </td>
                        <td>${row.aiBoxLast || "-"}</td>

                        <td class="${row.mediaStatus || "stopped"}">
                            ${row.mediaStatus || "stopped"}
                        </td>
                        <td>${row.mediaLast || "-"}</td>

                        <td class="${row.aiServerStatus || "stopped"}">
                            ${row.aiServerStatus || "stopped"}
                        </td>
                        <td>${row.aiServerLast || "-"}</td>

                        <td>${boxMetaMap[row.site]?.deviceName || row.deviceName || "-"}</td>

                        <td class="${row.nodeStatus || "offline"}">
                            ${row.nodeStatus || "offline"}
                        </td>
                        <td>${row.nodeLast || "-"}</td>
                    </tr>
                `).join("");

            document.getElementById("aiTotalHB").innerText = summary.ai.total;
            document.getElementById("aiOnlineDuration").innerText = summary.ai.online;
            document.getElementById("aiOfflineDuration").innerText = summary.ai.offline;
            document.getElementById("nodeTotalHB").innerText = summary.node.total;
            document.getElementById("nodeOnlineDuration").innerText = summary.node.online;
            document.getElementById("nodeOfflineDuration").innerText = summary.node.offline;

        } catch (err) {
            console.error("Live status load failed:", err);
        }
    }

    function applyFilter() {
        appliedFilters.type = document.getElementById("typeFilter").value;
        appliedFilters.boxCode = document.getElementById("boxCodeFilter").value;
        appliedFilters.from = document.getElementById("fromFilter").value;
        appliedFilters.to = document.getElementById("toFilter").value;
        appliedFilters.status = document.getElementById("statusFilter").value;

        const noFilterSelected =
            appliedFilters.type === "ALL" &&
            !appliedFilters.boxCode &&
            !appliedFilters.from &&
            !appliedFilters.to &&
            appliedFilters.status === "all";

        if (noFilterSelected) {
            filterApplied = false;
            loadLogs(false);
        } else {
            filterApplied = true;
            loadLogs(true);
        }
    }

    function resetFilter() {
        filterApplied = false;

        appliedFilters = {
            type: "ALL",
            boxCode: "",
            from: "",
            to: "",
            status: "all"
        };

        document.getElementById("typeFilter").value = "ALL";
        document.getElementById("boxCodeFilter").value = "";
        document.getElementById("fromFilter").value = "";
        document.getElementById("toFilter").value = "";
        document.getElementById("statusFilter").value = "all";

        setDefaultFromDate();
        loadLogs(false);
    }

    // ================= INITIAL LOAD =================
    loadCurrentUser().then((currentUser) => {
        if (!currentUser) return;

        const usernameEl = document.getElementById("currentUsername");
        if (usernameEl) {
            usernameEl.innerText = currentUser.username;
        }

        const role = (currentUser.role || "").trim().toLowerCase();

        if (role !== "user") {
            window.location.href = "/dashboard-admin.html";
            return;
        }

        loadBoxMeta().then(() => {
            loadFilters();
            initMap();
            loadLocations().then(() => {
                loadLiveStatus();
            });
        });

        setTimeout(() => {
            const fromInput = document.getElementById("fromFilter");
            if (fromInput) {
                fromInput.value = "";
                setDefaultFromDate();
            }
        }, 0);

        loadLogs(false);

        setInterval(() => {
            loadLocations().then(() => {
                loadLiveStatus();
            });

            if (filterApplied) {
                loadLogs(true);
            } else {
                loadLogs(false);
            }
        }, 5000);
    });

    document.getElementById("applyFilterBtn").addEventListener("click", applyFilter);
    document.getElementById("resetFilterBtn").addEventListener("click", resetFilter);
    document.getElementById("searchBox").addEventListener("change", findBoxOnMap);
    document.getElementById("logoutBtn").addEventListener("click", logout);
});