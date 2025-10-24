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
  InfoCircleOutlined,
  BarChartOutlined,
  PlayCircleOutlined,
  StopOutlined,
  AreaChartOutlined,
} from "@ant-design/icons";
import { useSession } from "next-auth/react";

import HistoricalCharts from "../components/HistoricalCharts";
import AddPlantModal from "../components/addPlantModal"; // ⬅️ use the memoized modal (fixes flicker)

const { Title, Paragraph, Text } = Typography;
const { Option } = Select;

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
      setSensorData(json || {});
      if (json?.idealConditions) setIdealConditions(json.idealConditions);
      if (json?.selectedPlant) setSelectedPlant(json.selectedPlant);
      if (json?.selectedStage) setSelectedStage(json.selectedStage);
      if (json?.selectedStage) setDropdownStage(json.selectedStage);
      if (json?.selectedStage) setNewStage(json.selectedStage);
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
      // retain previously selected preset if still available
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
  }; // :contentReference[oaicite:3]{index=3}

  const handleStageUpdate = () => {
    if (!selectedPlant) return;
    handlePlantSelection(selectedPlant, newStage);
  };

  const handleAbortPlant = async () => {
    try {
      // Try to capture chart snapshots if the historical modal has been opened before
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
  }; // :contentReference[oaicite:4]{index=4}

  const openHistoricalGraph = () => setShowGraphModal(true);

  // ---------- Modals ----------
  const ChartModal = () => (
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
      {/* HistoricalCharts keeps previous render during background fetches */}
      <HistoricalCharts ref={chartsRef} show={showGraphModal} />
    </Modal>
  ); // :contentReference[oaicite:5]{index=5}

  // (Inline PlantCreationModal removed — it caused page re-renders on each keypress) :contentReference[oaicite:6]{index=6}

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

  const { _id, timestamp, pump, light, tds, distance, sensors } = sensorData || {};
  const { light_pwm_cycle, idealRanges } = idealConditions || {};

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

        {/* Account */}
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
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Account Id</p>
              <p className={styles.infoValue}>{session.user.id}</p>
            </div>
          </div>
        </Card>

        {/* Dashboard header */}
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
                <Option value="seedling">Seedling</Option>
                <Option value="vegetative">Vegetative</Option>
                <Option value="flowering">Flowering</Option>
                <Option value="mature">Mature</Option>
                <Option value="harvest">Harvest</Option>
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
                  <Option value="seedling">Seedling</Option>
                  <Option value="vegetative">Vegetative</Option>
                  <Option value="flowering">Flowering</Option>
                  <Option value="mature">Mature</Option>
                  <Option value="harvest">Harvest</Option>
                </Select>
                <Button onClick={handleStageUpdate} style={{ marginLeft: 8 }}>
                  Update
                </Button>
              </div>
            )}
          </div>

          <Divider />

          {/* Live sensor panel (simplified placeholder; keep your real layout) */}
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card>
                <Title level={5} style={{ marginBottom: 8 }}>
                  Live Sensors
                </Title>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
{JSON.stringify(sensorData, null, 2)}
                </pre>
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card>
                <Title level={5} style={{ marginBottom: 8 }}>
                  Ideal Conditions
                </Title>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
{JSON.stringify(idealConditions, null, 2)}
                </pre>
              </Card>
            </Col>
          </Row>
        </div>
      </main>

      {/* Modals */}
      <ChartModal />

      <AddPlantModal
        visible={showPlantModal}
        onClose={() => setShowPlantModal(false)}
        onSuccess={fetchSensorData}       // e.g., refresh after new plant
        deviceId={undefined}              // pass if you track device targeting
      />
    </div>
  );
}

/** Trivial navbar (keep your own) */
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
