document.addEventListener("DOMContentLoaded", () => {
    let map;
    let markers = {};
    let hasFittedMap = false;

    let boxLocationMap = {

    };
    let boxMetaMap = {};

    let filterApplied = false;

    let appliedFilters = {
        type: "ALL",
        boxCode: "",
        from: "",
        to: "",
        status: "all"
    };
    function openMapPickerModal() {
    document.getElementById("mapPickerModal").classList.remove("hidden");

    setTimeout(() => {
        if (!pickerMap) {
            pickerMap = L.map('pickerMap').setView(map.getCenter(), map.getZoom());

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(pickerMap);

            pickerMap.on("click", (e) => {
                pickedLatLng = e.latlng;

                if (pickedLocationMarker) {
                    pickerMap.removeLayer(pickedLocationMarker);
                }

                pickedLocationMarker = L.marker([pickedLatLng.lat, pickedLatLng.lng]).addTo(pickerMap);
            });
        } else {
            pickerMap.setView(map.getCenter(), map.getZoom());
            pickerMap.invalidateSize();
        }

        // If current lat/lng already exist, show current point
        const lat = parseFloat(document.getElementById("latInput").value);
        const lng = parseFloat(document.getElementById("lngInput").value);

        if (!isNaN(lat) && !isNaN(lng)) {
            pickedLatLng = { lat, lng };

            if (pickedLocationMarker) {
                pickerMap.removeLayer(pickedLocationMarker);
            }

            pickedLocationMarker = L.marker([lat, lng]).addTo(pickerMap);
            pickerMap.setView([lat, lng], 16);
        }
    }, 100);
}

function closeMapPickerModal() {
    document.getElementById("mapPickerModal").classList.add("hidden");
}

function usePickedLocation() {
    if (!pickedLatLng) {
        alert("Please click a location on the map first.");
        return;
    }

    document.getElementById("latInput").value = pickedLatLng.lat.toFixed(6);
    document.getElementById("lngInput").value = pickedLatLng.lng.toFixed(6);

    closeMapPickerModal();
}
    
    function openMetaModal() {
        document.getElementById("metaModal").classList.remove("hidden");
    }

    function closeMetaModal() {
        document.getElementById("metaModal").classList.add("hidden");
    }

    function fillMetaInputs() {
        const boxCode = document.getElementById("metaBox").value;
        const meta = boxMetaMap[boxCode] || {};

        document.getElementById("boxNameInput").value = meta.boxName || "";
        document.getElementById("deviceNameInput").value = meta.deviceName || "";
    }

    function initMap() {
        map = L.map('map').setView([13.7563, 100.5018], 6);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        
    }
    async function saveBoxMeta() {
        const boxCode = document.getElementById("metaBox").value;
        const boxName = document.getElementById("boxNameInput").value.trim();
        const deviceName = document.getElementById("deviceNameInput").value.trim();

        if (!boxCode) {
            alert("Please select a box.");
            return;
        }

        try {
            const res = await fetch("/box-meta", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ boxCode, boxName, deviceName })
            });

            const result = await res.json();

            if (!res.ok) {
                throw new Error(result.error || "Failed to save box information");
            }

            alert("Box information saved successfully.");
            closeMetaModal();
            loadBoxMeta().then(() => {
                loadFilters();
                loadLiveStatus();
            });

        } catch (err) {
            console.error("Save box meta failed:", err);
            alert("Failed to save box information.");
        }
    } async function loadBoxMeta() {
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
                return; // keep existing fallback boxLocationMap
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
            AI Box: ${row.aiBoxStatus}<br>
            Node-RED: ${row.nodeStatus}
        `;

            if (markers[row.site]) {
                markers[row.site].setStyle({
                    fillColor: color
                });
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
    function openEditModal() {
        const modal = document.getElementById("editModal");
        const selectedBox = document.getElementById("searchBox").value;
        const locationBox = document.getElementById("locationBox");

        modal.classList.remove("hidden");

        if (selectedBox) {
            locationBox.value = selectedBox;
            fillLocationInputs();
        }
    }

    function closeEditModal() {
        document.getElementById("editModal").classList.add("hidden");
    }

    function findBoxOnMap() {
        const boxCode = document.getElementById("searchBox").value;

        if (!boxCode) {
            return;
        }

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
    function fillLocationInputs() {
        const boxCode = document.getElementById("locationBox").value;
        const location = boxLocationMap[boxCode];

        document.getElementById("latInput").value = location ? location.lat : "";
        document.getElementById("lngInput").value = location ? location.lng : "";
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
            const locationSelect = document.getElementById("locationBox");
            const searchSelect = document.getElementById("searchBox");
            const metaSelect = document.getElementById("metaBox");
            boxSelect.innerHTML = '<option value="">All Box Codes</option>';
            locationSelect.innerHTML = '<option value="">Select Box</option>';
            searchSelect.innerHTML = `
                <option value="">Select Box</option>
                 <option value="ALL">All Boxes</option>`;
            metaSelect.innerHTML = '<option value="">Select Box</option>';

            data.boxCodes.forEach(code => {
                if (code) {

                    const displayName = boxMetaMap[code]?.boxName || code;



                    boxSelect.innerHTML += `
                    <option value="${code}">
                        ${displayName}
                    </option>
                `;

                    locationSelect.innerHTML += `
                    <option value="${code}">
                        ${displayName}
                    </option>
                `;
                    searchSelect.innerHTML += `
                    <option value="${code}">
                        ${displayName}
                    </option>
                `;

                    metaSelect.innerHTML += `
                    <option value="${code}">
                       ${displayName}
                     </option>`;
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


        logs = logs.sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

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
            const selectedStatus = appliedFilters.status;

            if (
                selectedStatus !== "all" &&
                current.online_status !== selectedStatus
            ) {
                continue;
            }
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
    </tr>`;
        }
        // Count rows shown in table
        const totalRows = html ? html.split("<tr>").length - 1 : 0;

        //  Sum ALL durations (online + offline)
        const totalDurationMs = totalOnlineMs + totalOfflineMs;

        //  Update cards
        document.getElementById("totalRows").innerText = totalRows;
        document.getElementById("totalDuration").innerText = formatDuration(totalDurationMs);
        document.getElementById("logTable").innerHTML = html;
        document.getElementById("logTable").innerHTML = html;
        const title = document.getElementById("totalRowsTitle");

        if (appliedFilters.status === "online") {
            title.innerText = "Total Online";
            title.style.color = "#16a34a";
            // value.style.color = "#16a34a";
        } else if (appliedFilters.status === "offline") {
            title.innerText = "Total Offline";
            title.style.color = "#dc2626";
            // value.style.color = "#dc2626";
        } else {
            title.innerText = "Total";
            title.style.color = "";
            // value.style.color = "";
        }
    }


    async function loadLiveStatus() {

        try {
            const res = await fetch("/boxes");
            const data = await res.json();

            // Safe fallback
            const rows = data.boxes || [];
            updateMapMarkers(rows);
            const summary = data.summary || {
                ai: { total: 0, online: 0, offline: 0 },
                node: { total: 0, online: 0, offline: 0 }
            };

            // ================= LIVE TABLE ================= //
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

            // ================= SUMMARY CARDS =================//

            document.getElementById("aiTotalHB").innerText =
                summary.ai.total;

            document.getElementById("aiOnlineDuration").innerText =
                summary.ai.online;

            document.getElementById("aiOfflineDuration").innerText =
                summary.ai.offline;

            document.getElementById("nodeTotalHB").innerText =
                summary.node.total;

            document.getElementById("nodeOnlineDuration").innerText =
                summary.node.online;

            document.getElementById("nodeOfflineDuration").innerText =
                summary.node.offline;

        } catch (err) {
            console.error("Live status load failed:", err);
        }
    }
    async function saveLocation() {
        const boxCode = document.getElementById("locationBox").value;
        const lat = parseFloat(document.getElementById("latInput").value);
        const lng = parseFloat(document.getElementById("lngInput").value);

        if (isNaN(lat) || isNaN(lng)) {
            alert("Please enter valid latitude and longitude.");
            return;
        }

        try {
            const res = await fetch("/locations", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ boxCode, lat, lng })
            });

            const result = await res.json();

            if (!res.ok) {
                throw new Error(result.error || "Failed to save location");
            }
            alert("Location saved successfully.");
            closeEditModal();

            hasFittedMap = false;

            await loadLocations();
            await loadLiveStatus();


            document.getElementById("latInput").value = "";
            document.getElementById("lngInput").value = "";

        } catch (err) {
            console.error("Save location failed:", err);
            alert("Failed to save location.");
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
    loadBoxMeta().then(() => {
        loadFilters();
        initMap();
        loadLocations().then(() => {
            loadLiveStatus();
        });
    });
    // Delay to override browser restore
    setTimeout(() => {
        const fromInput = document.getElementById("fromFilter");
        fromInput.value = "";
        setDefaultFromDate();
    }, 0);

    loadLogs(false);

    // Auto Refresh
    setInterval(() => {

        loadLocations().then(() => {
            loadLiveStatus();
        });

        if (filterApplied) {
            loadLogs(true);   // keep showing filtered data
        } else {
            loadLogs(false);  // show latest 5 logs
        }

    }, 5000);
    window.applyFilter = applyFilter;
    window.resetFilter = resetFilter;
    window.saveLocation = saveLocation;
    window.findBoxOnMap = findBoxOnMap;

    window.fillLocationInputs = fillLocationInputs;
    window.openEditModal = openEditModal;
    window.closeEditModal = closeEditModal;
    window.openMetaModal = openMetaModal;
    window.closeMetaModal = closeMetaModal;
    window.fillMetaInputs = fillMetaInputs;
    window.saveBoxMeta = saveBoxMeta;
    window.enableMapPickMode = enableMapPickMode;
    window.openMapPickerModal = openMapPickerModal;
window.closeMapPickerModal = closeMapPickerModal;
window.usePickedLocation = usePickedLocation;

});