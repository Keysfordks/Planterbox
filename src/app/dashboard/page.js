"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Card, Avatar, Spin, message, Select, Button, Alert, Tooltip, Modal,
  Typography, Divider, Input, Form, InputNumber, Row, Col
} from "antd";
import Navbar from "../../components/navbar";
import styles from "../../styles/dashboard.module.css";
import { FaInfoCircle, FaLeaf } from "react-icons/fa";

// Charts (exposes ref.getSnapshots())
import HistoricalCharts from "../../components/HistoricalCharts";
// Past Grows grid
import PastGrowsGrid from "../../components/PastGrowsGrid";

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

const sensorNames = {
  temperature: "Temperature (°C)",
  humidity: "Humidity (%)",
  ph: "pH Level",
  ppm: "PPM (Nutrients)",
  water_sufficient: "Water Level",
};

const GROWTH_STAGES = ["seedling", "vegetative", "mature"];

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [selectedPlant, setSelectedPlant] = useState(null);
  const [selectedStage, setSelectedStage] = useState(null);
  const [dropdownStage, setDropdownStage] = useState("seedling");
  const [newStage, setNewStage] = useState("seedling");

  const [sensorData, setSensorData] = useState({});
  const [idealConditions, setIdealConditions] = useState({});
  const [sensorStatus, setSensorStatus] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  // Historical chart modal + ref for snapshots
  const [showGraphModal, setShowGraphModal] = useState(false);
  const chartsRef = useRef(null);

  // Plant creation modal/presets
  const [showPlantModal, setShowPlantModal] = useState(false);
  const [availablePresets, setAvailablePresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [isCustomPlant, setIsCustomPlant] = useState(false);
  const [form] = Form.useForm();

  // Fetch plant presets
  const fetchPlantPresets = async () => {
    try {
      const response = await fetch("/api/plants?presets=true");
      if (!response.ok) throw new Error("Failed to load plant presets");
      const data = await response.json();
      setAvailablePresets(data.presets || []);
    } catch (error) {
      console.error("Error fetching presets:", error);
      message.error("Error loading plant presets");
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
    if (status === "authenticated") fetchPlantPresets();
  }, [status, router]);

  useEffect(() => {
    const savedPlant = localStorage.getItem("selectedPlant");
    const savedStage = localStorage.getItem("selectedStage");
    if (savedPlant) setSelectedPlant(savedPlant);
    if (savedStage) {
      setSelectedStage(savedStage);
      setDropdownStage(savedStage);
      setNewStage(savedStage);
    }
  }, []);

  useEffect(() => {
    if (!selectedPlant || !selectedStage) return;

    const fetchIdealConditions = async () => {
      try {
        const res = await fetch(`/api/sensordata?plant=${selectedPlant}&stage=${selectedStage}`);
        const data = await res.json();
        setIdealConditions(data.ideal_conditions);
      } catch (e) {
        console.error("Failed to fetch ideal conditions:", e);
      }
    };

    const fetchData = async () => {
      try {
        const res = await fetch("/api/sensordata");
        const data = await res.json();
        setSensorData(data.sensorData);
        setSensorStatus(data.sensorStatus);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (e) {
        console.error("Failed to fetch sensor data:", e);
      }
    };

    fetchIdealConditions();
    fetchData();
    const intervalId = setInterval(fetchData, 3000);
    return () => clearInterval(intervalId);
  }, [selectedPlant, selectedStage]);

  // Debug: log modal open prop changes
  useEffect(() => {
    console.log('showGraphModal ->', showGraphModal, 'at', new Date().toLocaleTimeString());
  }, [showGraphModal]);

  const handleCreatePlant = async () => {
    try {
      const values = await form.validateFields();

      const initialStage = dropdownStage; // which stage becomes active after creation

      if (isCustomPlant) {
        const build = (obj) => ({
          temp_min: obj.temp_min,
          temp_max: obj.temp_max,
          humidity_min: obj.humidity_min,
          humidity_max: obj.humidity_max,
          ph_min: obj.ph_min,
          ph_max: obj.ph_max,
          ppm_min: obj.ppm_min,
          ppm_max: obj.ppm_max,
          light_pwm_cycle: obj.light_pwm_cycle,
        });

        const stages = {
          seedling:   build(values.seedling),
          vegetative: build(values.vegetative),
          mature:     build(values.mature),
        };

        const res = await fetch("/api/plants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plant_name: values.customPlantName,
            stages,
            initial_stage: initialStage
          }),
        });
        if (!res.ok) throw new Error("Failed to create plant");

        // Keep local UI in sync with server selection
        await handlePlantSelection(values.customPlantName, initialStage);

        setSelectedPlant(values.customPlantName);
        setSelectedStage(initialStage);
        setNewStage(initialStage);
        localStorage.setItem("selectedPlant", values.customPlantName);
        localStorage.setItem("selectedStage", initialStage);

        setShowPlantModal(false);
        setIsCustomPlant(false);
        form.resetFields();
        message.success(`${values.customPlantName} created with 3 stages!`);
        return;
      }

      // ---- Preset path (placeholder-ready, unchanged functionality) ----
      if (!selectedPreset) {
        message.error("Please select a plant type");
        return;
      }
      const presetResponse = await fetch(
        `/api/plants?presets=true&plant=${selectedPreset.plant_name}&stage=${dropdownStage}`
      );
      const presetData = await presetResponse.json();
      const initialStages = selectedPreset?.stages || {
        seedling: presetData.ideal_conditions,
        vegetative: presetData.ideal_conditions,
        mature: presetData.ideal_conditions
      };

      const res = await fetch("/api/plants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plant_name: values.customPlantName,
          stages: initialStages,
          initial_stage: dropdownStage
        }),
      });
      if (!res.ok) throw new Error("Failed to create plant");

      await handlePlantSelection(values.customPlantName, dropdownStage);
      setSelectedPlant(values.customPlantName);
      setSelectedStage(dropdownStage);
      setNewStage(dropdownStage);
      localStorage.setItem("selectedPlant", values.customPlantName);
      localStorage.setItem("selectedStage", dropdownStage);
      setShowPlantModal(false);
      setIsCustomPlant(false);
      form.resetFields();
      message.success(`${values.customPlantName} created successfully!`);
    } catch (error) {
      console.error("Error creating plant:", error);
      message.error("Please fill in all required fields");
    }
  };

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

  const { _id, timestamp, pump, light, tds, distance, ...sensors } = sensorData || {};
  const { light_pwm_cycle, ...idealRanges } = idealConditions || {};

  return (
    <div className={styles.container}>
      <Navbar session={session} />

      <main className={styles.main}>
        <Card className={styles.welcomeCard}>
          <div className={styles.welcomeContent}>
            <Avatar src={session.user?.image} size={64} className={styles.avatar} />
            <div>
              <h2 className={styles.welcomeTitle}>Welcome back, {session.user?.name || "User"}!</h2>
              <p className={styles.welcomeEmail}>{session.user?.email}</p>
            </div>
          </div>
        </Card>

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
          </div>
        </Card>

        {/* Main Dashboard Card */}
        <div className={styles.dashboardCard}>
          <div className={styles.dashboardHeader}>
            <h1 className={styles.dashboardTitle}>{headerText}</h1>
          </div>

          {selectedPlant && selectedStage ? (
            <>
              <p className={styles.lastUpdated}>Last updated: {lastUpdated}</p>

              {/* Sensor Cards */}
              <div className={styles.sensorGrid}>
                {Object.keys(sensors)
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
                          <div className={styles.sensorName}>
                            {sensorNames[key] || key}
                          </div>

                          <div className={`${styles.sensorValue} ${statusClass}`}>
                            {valueDisplay}
                          </div>

                          {idealText && (
                            <div className={styles.idealRange}>{idealText}</div>
                          )}
                        </div>

                        {key === "ppm" && status === "DILUTE_WATER" && (
                          <div className={styles.ppmWarning}>
                            <p className={styles.ppmWarningText}>
                              PPM TOO HIGH: Manual dilution required. Please add
                              distilled water to lower nutrient concentration.
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
              <FaLeaf style={{ fontSize: "64px", color: "#d1d5db", marginBottom: "24px" }} />
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
                  fontWeight: "bold",
                }}
              >
                Create Plant
              </Button>
            </div>
          )}
        </div>

        {/* Utility Bar (when selected) */}
        {selectedPlant && selectedStage && (
          <div className={styles.utilityBar}>
            <div className={styles.utilityCardLeft}>
              <div className={styles.utilityCard}>
                <Button
                  type="primary"
                  onClick={openHistoricalGraph}
                  style={{ backgroundColor: "#10b981", borderColor: "#10b981", fontWeight: "bold" }}
                >
                  View Historical Growth
                </Button>
              </div>
            </div>

            <div className={styles.utilityCardRight}>
              <div className={styles.stageUpdateCard}>
                <p className={styles.stageUpdateLabel}>Update Growth Stage:</p>
                <div className={styles.stageUpdateControls}>
                  <Select value={newStage} onChange={(v) => setNewStage(v)} style={{ flex: 1 }}>
                    {GROWTH_STAGES.map((stage) => (
                      <Option key={stage} value={stage}>
                        {stage.charAt(0).toUpperCase() + stage.slice(1)} Stage
                      </Option>
                    ))}
                  </Select>
                  <Button type="primary" onClick={handleStageUpdate} style={{ fontWeight: "bold" }}>
                    Update
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Past Grows Section */}
        <div style={{ marginTop: 24 }}>
          <Title level={4} style={{ margin: "0 0 12px" }}>
            Past Grows
          </Title>
          <Paragraph style={{ color: "#6b7280", marginBottom: 16 }}>
            Review archived plants, summary stats, and saved chart snapshots.
          </Paragraph>
          <PastGrowsGrid />
        </div>
      </main>

      {/* === Persistent Graph Overlay (no unmounts) === */}
      <div
        id="graph-overlay"
        aria-hidden={showGraphModal ? "false" : "true"}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowGraphModal(false); // click backdrop closes
        }}
        style={{
          position: 'fixed',
          inset: 0,
          display: showGraphModal ? 'flex' : 'none',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)',
          zIndex: 9999,
          padding: '24px',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          style={{
            width: 'min(1200px, 92vw)',
            maxHeight: '88vh',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span style={{ fontWeight: 600 }}>Historical Growth</span>
            <Button onClick={() => setShowGraphModal(false)}>Close</Button>
          </div>

          {/* Content: charts remain mounted forever */}
          <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
            <HistoricalCharts ref={chartsRef} show={showGraphModal} />
          </div>
        </div>
      </div>
      
      {/* Plant Creation Modal */}
      <Modal
        open={showPlantModal}
        onCancel={() => {
          setShowPlantModal(false);
          setIsCustomPlant(false);
          form.resetFields();
        }}
        footer={null}
        width={700}
        centered
        closable
        maskClosable
        destroyOnClose={false}
      >
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <Title level={2} style={{ marginBottom: "8px" }}>
            🌱 Create Your Plant
          </Title>

          <Paragraph style={{ fontSize: "16px", color: "#6b7280", marginBottom: "32px" }}>
            Choose a plant preset or create a custom configuration.
          </Paragraph>

          <Form
            form={form}
            layout="vertical"
            style={{ maxWidth: "600px", margin: "0 auto", textAlign: "left" }}
            initialValues={{
              dropdownStage: "seedling",
              // sensible defaults for all three stages
              seedling:   { temp_min: 20, temp_max: 26, humidity_min: 50, humidity_max: 70, ph_min: 5.5, ph_max: 6.5, ppm_min: 400, ppm_max: 800, light_pwm_cycle: 12 },
              vegetative: { temp_min: 21, temp_max: 27, humidity_min: 45, humidity_max: 65, ph_min: 5.8, ph_max: 6.6, ppm_min: 700, ppm_max: 1000, light_pwm_cycle: 14 },
              mature:     { temp_min: 22, temp_max: 28, humidity_min: 40, humidity_max: 60, ph_min: 6.0, ph_max: 6.8, ppm_min: 900, ppm_max: 1200, light_pwm_cycle: 12 },
            }}
          >
            <Form.Item
              name="customPlantName"
              label={<Text strong>Plant Name</Text>}
              rules={[{ required: true, message: "Please enter a name for your plant" }]}
            >
              <Input size="large" placeholder="e.g., My Pothos Plant" />
            </Form.Item>

            <Form.Item label={<Text strong>Configuration Type</Text>} required>
              <Select
                size="large"
                placeholder="Choose preset or custom"
                value={isCustomPlant ? "custom" : selectedPreset?.plant_name}
                onChange={(value) => {
                  if (value === "custom") {
                    setIsCustomPlant(true);
                    setSelectedPreset(null);
                  } else {
                    setIsCustomPlant(false);
                    const preset = availablePresets.find((p) => p.plant_name === value);
                    setSelectedPreset(preset);
                  }
                }}
                style={{ width: "100%" }}
              >
                {availablePresets.map((preset) => (
                  <Option key={preset._id || preset.plant_name} value={preset.plant_name}>
                    {preset.plant_name.charAt(0).toUpperCase() + preset.plant_name.slice(1)}
                  </Option>
                ))}
                <Option value="custom">Custom Configuration</Option>
              </Select>
            </Form.Item>

            {/* ---- three-stage custom UI ---- */}
            {isCustomPlant && (
              <>
                <Alert
                  message="Custom Plant Configuration"
                  description="Define ideal environmental ranges for each stage. Switch stages any time during growth."
                  type="info"
                  showIcon
                  style={{ marginBottom: "16px" }}
                />

                {/* Seedling */}
                <Title level={5} style={{ marginTop: 8 }}>Seedling</Title>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="Temp Min (°C)" name={['seedling', 'temp_min']} rules={[{ required: true, message: 'Required' }]} >
                      <InputNumber style={{ width: "100%" }} min={10} max={40} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Temp Max (°C)" name={['seedling', 'temp_max']} rules={[{ required: true, message: 'Required' }]} >
                      <InputNumber style={{ width: "100%" }} min={10} max={40} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="Humidity Min (%)" name={['seedling', 'humidity_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={100} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Humidity Max (%)" name={['seedling', 'humidity_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={100} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="pH Min" name={['seedling', 'ph_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={14} step={0.1} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="pH Max" name={['seedling', 'ph_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={14} step={0.1} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="PPM Min" name={['seedling', 'ppm_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={5000} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="PPM Max" name={['seedling', 'ppm_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={5000} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item label="Light PWM Cycle (hrs/day)" name={['seedling', 'light_pwm_cycle']} rules={[{ required: true, message: 'Required' }]}>
                  <InputNumber style={{ width: "100%" }} min={0} max={24} />
                </Form.Item>

                <Divider />

                {/* Vegetative */}
                <Title level={5}>Vegetative</Title>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="Temp Min (°C)" name={['vegetative', 'temp_min']} rules={[{ required: true, message: 'Required' }]} >
                      <InputNumber style={{ width: "100%" }} min={10} max={40} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Temp Max (°C)" name={['vegetative', 'temp_max']} rules={[{ required: true, message: 'Required' }]} >
                      <InputNumber style={{ width: "100%" }} min={10} max={40} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="Humidity Min (%)" name={['vegetative', 'humidity_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={100} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Humidity Max (%)" name={['vegetative', 'humidity_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={100} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="pH Min" name={['vegetative', 'ph_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={14} step={0.1} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="pH Max" name={['vegetative', 'ph_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={14} step={0.1} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="PPM Min" name={['vegetative', 'ppm_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={5000} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="PPM Max" name={['vegetative', 'ppm_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={5000} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item label="Light PWM Cycle (hrs/day)" name={['vegetative', 'light_pwm_cycle']} rules={[{ required: true, message: 'Required' }]}>
                  <InputNumber style={{ width: "100%" }} min={0} max={24} />
                </Form.Item>

                <Divider />

                {/* Mature */}
                <Title level={5}>Mature</Title>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="Temp Min (°C)" name={['mature', 'temp_min']} rules={[{ required: true, message: 'Required' }]} >
                      <InputNumber style={{ width: "100%" }} min={10} max={40} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Temp Max (°C)" name={['mature', 'temp_max']} rules={[{ required: true, message: 'Required' }]} >
                      <InputNumber style={{ width: "100%" }} min={10} max={40} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="Humidity Min (%)" name={['mature', 'humidity_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={100} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Humidity Max (%)" name={['mature', 'humidity_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={100} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="pH Min" name={['mature', 'ph_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={14} step={0.1} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="pH Max" name={['mature', 'ph_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={14} step={0.1} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="PPM Min" name={['mature', 'ppm_min']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={5000} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="PPM Max" name={['mature', 'ppm_max']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber style={{ width: "100%" }} min={0} max={5000} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item label="Light PWM Cycle (hrs/day)" name={['mature', 'light_pwm_cycle']} rules={[{ required: true, message: 'Required' }]}>
                  <InputNumber style={{ width: "100%" }} min={0} max={24} />
                </Form.Item>
              </>
            )}

            <Form.Item
              label={
                <Text strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Growth Stage
                  <Tooltip
                    title="Our kit groups plant growth into 3 broad stages. Click to learn more."
                    placement="right"
                  >
                    <a
                      href="https://www.saferbrand.com/articles/plant-growth-stages"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#10b981" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FaInfoCircle />
                    </a>
                  </Tooltip>
                </Text>
              }
              name="dropdownStage"
            >
              <Select size="large" value={dropdownStage} onChange={(value) => setDropdownStage(value)} style={{ width: "100%" }}>
                {GROWTH_STAGES.map((stage) => (
                  <Option key={stage} value={stage}>
                    {stage.charAt(0).toUpperCase() + stage.slice(1)} Stage
                  </Option>
                ))}
              </Select>
            </Form.Item>

            {!isCustomPlant && (
              <>
                <Divider style={{ margin: "16px 0" }} />
                <Alert
                  message="Setup Instructions"
                  description="Fill the tank to the marked range with distilled water before starting. Add water as needed."
                  type="info"
                  showIcon
                  style={{ marginBottom: "16px" }}
                />
              </>
            )}

            <Button
              type="primary"
              size="large"
              onClick={handleCreatePlant}
              block
              style={{
                height: "48px",
                fontSize: "16px",
                fontWeight: "bold",
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                border: "none",
                marginTop: "16px",
              }}
            >
              Create & Start Monitoring
            </Button>
          </Form>
        </div>
      </Modal>
    </div>
  );
}
