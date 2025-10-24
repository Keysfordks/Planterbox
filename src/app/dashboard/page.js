'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import {
  Card,
  Avatar,
  Spin,
  message,
  Select,
  Button,
  Alert,
  Tooltip,
  Modal,
  Typography,
  Divider,
  Row,
  Col,
} from "antd";
import {
  BarChartOutlined,
  AreaChartOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useSession } from "next-auth/react";

import HistoricalCharts from "../components/HistoricalCharts";
import AddPlantModal from "../components/addPlantModal";

const { Title, Paragraph, Text } = Typography;
const { Option } = Select;

const GROWTH_STAGES = ['seedling', 'vegetative', 'flowering', 'mature', 'harvest'];

export default function DashboardPage() {
  const { data: session, status } = useSession();

  // ---------- State ----------
  const [sensorData, setSensorData] = useState({});
  const [idealConditions, setIdealConditions] = useState({});
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [selectedStage, setSelectedStage] = useState(null);
  const [dropdownStage, setDropdownStage] = useState("seedling");
  const [newStage, setNewStage] = useState("seedling");

  const [availablePresets, setAvailablePresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState(null);

  const [showGraphModal, setShowGraphModal] = useState(false);
  const [showPlantModal, setShowPlantModal] = useState(false);

  const chartsRef = useRef(null);

  // ---------- Data fetchers ----------
  const fetchSensorData = useCallback(async () => {
    try {
      const res = await fetch("/api/sensordata", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch sensordata");
      const json = await res.json();
      setSensorData(json?.sensorData || {});
      if (json?.idealConditions) setIdealConditions(json.idealConditions);
      if (json?.currentSelection?.plant) setSelectedPlant(json.currentSelection.plant);
      if (json?.currentSelection?.stage) setSelectedStage(json.currentSelection.stage);
      if (json?.currentSelection?.stage) setDropdownStage(json.currentSelection.stage);
      if (json?.currentSelection?.stage) setNewStage(json.currentSelection.stage);
    } catch (e) {
      console.error("fetchSensorData:", e);
    }
  }, []);

  const fetchPlantPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/plants?presets=true", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch presets");
      const json = await res.json();
      const presets = Array.isArray(json) ? json : [];
      setAvailablePresets(presets);
      if (selectedPreset) {
        const stillThere = presets.find(p => p.plant_name === selectedPreset.plant_name);
        if (!stillThere) setSelectedPreset(null);
      }
    } catch (e) {
      console.error("fetchPlantPresets:", e);
    }
  }, [selectedPreset]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchSensorData();
      fetchPlantPresets();
    }
  }, [status, fetchSensorData, fetchPlantPresets]);

  // ---------- Actions ----------
  const handlePlantSelection = async (plantName, stageName) => {
    try {
      const response = await fetch("/api/sensordata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "select_plant",
          selectedPlant: plantName,
          selectedStage: stageName,
        }),
      });
      if (!response.ok) throw new Error("Failed to save plant selection");
      setSelectedPlant(plantName);
      setSelectedStage(stageName);
      setNewStage(stageName);
      localStorage.setItem("selectedPlant", plantName);
      localStorage.setItem("selectedStage", stageName);
      message.success(`${plantName} (${stageName}) selected successfully!`);
    } catch (error) {
      console.error("Failed to send plant selection/stage update:", error);
      message.error("Error selecting plant");
    }
  };

  const handleStageUpdate = () => {
    if (!selectedPlant) return;
    handlePlantSelection(selectedPlant, newStage);
  };

  const handleAbortPlant = async () => {
    try {
      const snapshots = chartsRef.current?.getSnapshots?.() || null;

      const response = await fetch("/api/sensordata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abort_plant", snapshots }),
      });

      if (!response.ok) throw new Error("Failed to abort plant");

      setSelectedPlant(null);
      setSelectedStage(null);
      localStorage.removeItem("selectedPlant");
      localStorage.removeItem("selectedStage");
      setSensorData({});
      setIdealConditions({});
      setDropdownStage("seedling");
      setNewStage("seedling");
      setShowPlantModal(true);
      message.success("Plant aborted and archived");
    } catch (error) {
      console.error("Request failed:", error);
      message.error("Error aborting plant");
    }
  };

  const openHistoricalGraph = () => setShowGraphModal(true);

  // ---------- Derived helpers ----------
  const sensors = sensorData?.sensors || {};
  const sensorStatus = sensorData?.sensorStatus || {};
  const lastUpdated = sensorData?.timestamp
    ? new Date(sensorData.timestamp).toLocaleString()
    : "—";

  const idealRanges = useMemo(() => {
    if (!idealConditions) return null;
    return {
      temp_min: idealConditions.temp_min,
      temp_max: idealConditions.temp_max,
      humidity_min: idealConditions.humidity_min,
      humidity_max: idealConditions.humidity_max,
      ph_min: idealConditions.ph_min,
      ph_max: idealConditions.ph_max,
      ppm_min: idealConditions.ppm_min,
      ppm_max: idealConditions.ppm_max,
    };
  }, [idealConditions]);

  // ---------- Render ----------
  if (status === "loading") {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
      </div>
    );
  }
  if (!session) return null;

  const headerText =
    selectedPlant && selectedStage
      ? `${selectedPlant.charAt(0).toUpperCase() + selectedPlant.slice(1)} - ${
          selectedStage.charAt(0).toUpperCase() + selectedStage.slice(1)
        } Stage`
      : "Plant Dashboard";

  return (
    <div className={styles.container}>
      {/* Top Bar */}
      <Navbar session={session} />

      <main className={styles.main}>
        {/* Welcome */}
        <Card className={styles.welcomeCard}>
          <div className={styles.welcomeContent}>
            <Avatar src={session.user?.image} size={64} className={styles.avatar} />
            <div>
              <h2 className={styles.welcomeTitle}>Welcome back, {session.user?.name || "User"}!</h2>
              <p className={styles.welcomeEmail}>{session.user?.email}</p>
            </div>
          </div>
        </Card>

        {/* Account (Account Id removed) */}
        <Card title="Account Information" className={styles.accountCard}>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Name</p>
              <p className={styles.infoValue}>{session.user?.name || "Not provided"}</p>
            </div>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Email</p>
              <p className={styles.infoValue}>{session.user?.email || "Not provided"}</p>
            </div>
            {/* Account ID intentionally hidden */}
          </div>
        </Card>

        {/* Main Dashboard Card */}
        <div className={styles.dashboardCard}>
          <div className={styles.dashboardHeader}>
            <h1 className={styles.dashboardTitle}>{headerText}</h1>
            <div className={styles.actionsRow}>
              <Tooltip title="View historical charts">
                <Button icon={<AreaChartOutlined />} onClick={openHistoricalGraph}>
                  Historical
                </Button>
              </Tooltip>
              <Tooltip title="Abort current plant and archive (you can create a new one afterward)">
                <Button danger icon={<StopOutlined />} onClick={handleAbortPlant}>
                  Abort & Archive
                </Button>
              </Tooltip>
              <Tooltip title="Create a new plant profile (preset or custom)">
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setShowPlantModal(true)}>
                  New Plant
                </Button>
              </Tooltip>
            </div>
          </div>

          {selectedPlant && selectedStage ? (
            <>
              <p className={styles.lastUpdated}>Last updated: {lastUpdated}</p>

              {/* Selection controls */}
              <div className={styles.selectorRow}>
                <div className={styles.selector}>
                  <Text strong>Preset</Text>
                  <Select
                    showSearch
                    placeholder="Choose a preset"
                    value={selectedPreset?.plant_name || undefined}
                    onChange={(val) => {
                      const preset = availablePresets.find(p => p.plant_name === val);
                      setSelectedPreset(preset || null);
                    }}
                    style={{ minWidth: 220 }}
                    filterOption={(input, option) =>
                      (option?.value ?? "").toLowerCase().includes(input.toLowerCase())
                    }
                  >
                    {availablePresets.map((preset) => (
                      <Option key={preset._id} value={preset.plant_name}>
                        {preset.plant_name.charAt(0).toUpperCase() + preset.plant_name.slice(1)}
                      </Option>
                    ))}
                  </Select>
                </div>

                <div className={styles.selector}>
                  <Text strong>Stage</Text>
                  <Select
                    value={dropdownStage}
                    onChange={(v) => setDropdownStage(v)}
                    style={{ minWidth: 180 }}
                  >
                    {GROWTH_STAGES.map((s) => (
                      <Option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</Option>
                    ))}
                  </Select>
                  <Button
                    onClick={() => {
                      if (!selectedPreset) {
                        message.info("Pick a preset first (or use New Plant)");
                        return;
                      }
                      handlePlantSelection(selectedPreset.plant_name, dropdownStage);
                    }}
                    style={{ marginLeft: 8 }}
                  >
                    Select
                  </Button>
                </div>

                {selectedPlant && (
                  <div className={styles.selector}>
                    <Text strong>Update Stage</Text>
                    <Select value={newStage} onChange={setNewStage} style={{ minWidth: 180 }}>
                      {GROWTH_STAGES.map((s) => (
                        <Option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</Option>
                      ))}
                    </Select>
                    <Button onClick={handleStageUpdate} style={{ marginLeft: 8 }}>
                      Update
                    </Button>

                    {/* Edit custom parameters only if current plant is custom */}
                    {String(selectedPlant).toLowerCase() === 'custom' && (
                      <Button
                        style={{ marginLeft: 8 }}
                        onClick={() => setShowPlantModal(true)}
                      >
                        Edit custom parameters
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <Divider />

              {/* Sensor Cards */}
              <div className={styles.sensorGrid}>
                {Object.keys(sensors)
                  // Hide backend/internal fields
                  .filter(
                    (key) =>
                      ![
                        "userId",
                        "default_device",
                        "deviceId",
                        "_id",
                        "__v",
                        "timestamp",
                        "idealRanges",
                      ].includes(key)
                  )
                  .map((key) => {
                    const value = sensors[key];
                    const status = sensorStatus[key] || "Loading...";

                    let statusClass = styles.ideal;
                    let valueDisplay;

                    if (key === "water_sufficient") {
                      valueDisplay = value ? "IDEAL" : "TOO LOW";
                      statusClass = value ? styles.ideal : styles.warning;
                    } else if (key === "ppm" && status === "DILUTE_WATER") {
                      valueDisplay = value != null ? parseFloat(value).toFixed(2) : "Loading...";
                      statusClass = styles.dilute;
                    } else {
                      valueDisplay =
                        value != null
                          ? typeof value === "number"
                            ? parseFloat(value).toFixed(2)
                            : value
                          : "Loading...";
                      statusClass = status === "IDEAL" ? styles.ideal : styles.warning;
                    }

                    // Ideal line only when valid values exist (no "Range N/A")
                    const idealText =
                      idealRanges &&
                      ((key === "temperature" &&
                        idealRanges.temp_min != null &&
                        idealRanges.temp_max != null &&
                        `Ideal: ${idealRanges.temp_min}°C – ${idealRanges.temp_max}°C`) ||
                        (key === "humidity" &&
                          idealRanges.humidity_min != null &&
                          idealRanges.humidity_max != null &&
                          `Ideal: ${idealRanges.humidity_min}% – ${idealRanges.humidity_max}%`) ||
                        (key === "ph" &&
                          idealRanges.ph_min != null &&
                          idealRanges.ph_max != null &&
                          `Ideal: ${idealRanges.ph_min} – ${idealRanges.ph_max}`) ||
                        (key === "ppm" &&
                          idealRanges.ppm_min != null &&
                          idealRanges.ppm_max != null &&
                          `Ideal: ${idealRanges.ppm_min} – ${idealRanges.ppm_max}`));

                    return (
                      <div key={key} className={styles.sensorCardWrapper}>
                        <div className={styles.sensorCard}>
                          <div className={styles.sensorName}>{sensorNames[key] || key}</div>

                          <div className={`${styles.sensorValue} ${statusClass}`}>{valueDisplay}</div>

                          {idealText && <div className={styles.idealRange}>{idealText}</div>}
                        </div>

                        {key === "ppm" && status === "DILUTE_WATER" && (
                          <div className={styles.ppmWarning}>
                            <p className={styles.ppmWarningText}>
                              PPM TOO HIGH: Manual dilution required. Please add distilled water to lower nutrient
                              concentration.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              {/* Abort */}
              <div className={styles.abortSection}>
                <Button danger size="large" onClick={handleAbortPlant} style={{ fontWeight: "bold" }}>
                  Abort Plant
                </Button>
              </div>
            </>
          ) : (
            // Empty state
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <Title level={3} style={{ color: "#9ca3af", marginBottom: "16px" }}>
                No Plant Selected
              </Title>
              <Paragraph style={{ color: "#6b7280", marginBottom: "24px" }}>
                Create a plant to start monitoring your smart garden
              </Paragraph>
              <Button
                type="primary"
                size="large"
                onClick={() => setShowPlantModal(true)}
                style={{
                  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                  border: "none",
                }}
              >
                New Plant
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <Modal
        open={showGraphModal}
        onCancel={() => setShowGraphModal(false)}
        footer={null}
        width="90%"
        centered
        closable
        maskClosable
        destroyOnClose={false}
        style={{ top: 20 }}
        bodyStyle={{ padding: 0 }}
      >
        <HistoricalCharts ref={chartsRef} show={showGraphModal} />
      </Modal>

      <AddPlantModal
        visible={showPlantModal}
        onClose={() => setShowPlantModal(false)}
        onSuccess={fetchSensorData}
        deviceId={undefined}
        mode={String(selectedPlant).toLowerCase() === 'custom' ? 'edit' : 'create'}
        initial={
          String(selectedPlant).toLowerCase() === 'custom'
            ? { plant_name: 'custom', stage: newStage, ideal_conditions: idealConditions }
            : null
        }
      />
    </div>
  );
}

/** Basic navbar */
function Navbar({ session }) {
  return (
    <div className={styles.navbar}>
      <div className={styles.brand}>
        <BarChartOutlined style={{ marginRight: 8 }} />
        PlanterBox
      </div>
      <div className={styles.grow} />
      <div className={styles.user}>
        <Avatar src={session.user?.image} />
      </div>
    </div>
  );
}

/** Friendly display names */
const sensorNames = {
  temperature: "Temperature (°C)",
  humidity: "Humidity (%)",
  ph: "pH",
  ppm: "PPM (Nutrients)",
  water_sufficient: "Water Level",
};
