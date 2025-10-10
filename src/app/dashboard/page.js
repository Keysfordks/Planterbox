"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, Avatar, Spin, message, Select, Button, Alert, Tooltip, Modal, Space, Typography, Divider, Input, Form, InputNumber, Row, Col} from "antd";
import Navbar from "../../components/navbar";
import styles from "../../styles/dashboard.module.css";
import { FaInfoCircle, FaExclamationTriangle, FaSync, FaChartLine, FaLeaf, FaSeedling,} from "react-icons/fa";

const { Title, Text, Paragraph } = Typography;

const sensorNames = {
  temperature: "Temperature (°C)",
  humidity: "Humidity (%)",
  ph: "pH Level",
  ppm: "PPM (Nutrients)",
  water_sufficient: "Water Level",
};

const GROWTH_STAGES = ["seedling", "vegetative", "mature"];

const { Option } = Select;

// Growth Graph Component
const GrowthGraph = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className={styles.graphEmpty}>
        No historical data available yet. Keep monitoring!
      </div>
    );
  }

  const firstTimestamp = new Date(data[0].timestamp);
  const lastTimestamp = new Date(data[data.length - 1].timestamp);
  const daysOfData = Math.ceil(
    (lastTimestamp - firstTimestamp) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className={styles.graphContainer}>
      <h3 className={styles.graphTitle}>
        Growth Trend ({daysOfData} Days)
      </h3>
      <div className={styles.graphPlaceholder}>
        <p className={styles.graphPlaceholderTitle}>
          [Placeholder for Chart Library]
        </p>
        <ul className={styles.graphPlaceholderList}>
          <li>
            This chart would display a multi-series line graph for pH, PPM, and
            Temp.
          </li>
          <li>Data points: {data.length} records fetched.</li>
          <li>
            Time Range: {firstTimestamp.toLocaleDateString()} to{" "}
            {lastTimestamp.toLocaleDateString()}
          </li>
        </ul>
      </div>
      <p className={styles.graphFooter}>
        A charting library is required here to visualize the data.
      </p>
    </div>
  );
};

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
  const [showGraphModal, setShowGraphModal] = useState(false);
  const [historicalData, setHistoricalData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [showPlantModal, setShowPlantModal] = useState(false);
  const [availablePresets, setAvailablePresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [isCustomPlant, setIsCustomPlant] = useState(false);
  const [customIdealConditions, setCustomIdealConditions] = useState({
    temp_min: 20,
    temp_max: 26,
    humidity_min: 50,
    humidity_max: 70,
    ph_min: 5.5,
    ph_max: 6.5,
    ppm_min: 800,
    ppm_max: 1200,
    light_pwm_cycle: 75,
  });
  const [form] = Form.useForm();

  // Fetch plant presets from database
  const fetchPlantPresets = async () => {
    try {
      const response = await fetch("/api/plants?presets=true");
      if (response.ok) {
        const data = await response.json();
        setAvailablePresets(data.presets || []);
      } else {
        message.error("Failed to load plant presets");
      }
    } catch (error) {
      console.error("Error fetching presets:", error);
      message.error("Error loading plant presets");
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/signin");
    }
    
    if (status === "authenticated") {
      fetchPlantPresets();
    }
  }, [status, router]);

  useEffect(() => {
    const savedPlant = localStorage.getItem("selectedPlant");
    const savedStage = localStorage.getItem("selectedStage");

    if (savedPlant) {
      setSelectedPlant(savedPlant);
    }
    
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
        const response = await fetch(
          `/api/sensordata?plant=${selectedPlant}&stage=${selectedStage}`
        );
        const data = await response.json();
        setIdealConditions(data.ideal_conditions);
      } catch (error) {
        console.error("Failed to fetch ideal conditions:", error);
      }
    };

    const fetchData = async () => {
      try {
        const response = await fetch("/api/sensordata");
        const data = await response.json();
        setSensorData(data.sensorData);
        setSensorStatus(data.sensorStatus);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (error) {
        console.error("Failed to fetch sensor data:", error);
      }
    };

    fetchIdealConditions();
    fetchData();
    const intervalId = setInterval(() => {
      fetchData();
    }, 3000);

    return () => clearInterval(intervalId);
  }, [selectedPlant, selectedStage]);

  const handleCreatePlant = async () => {
    try {
      const values = await form.validateFields();
      
      let idealConditionsToUse;

      if (isCustomPlant) {
        // Use custom ideal conditions from form
        idealConditionsToUse = customIdealConditions;
      } else {
        // Use preset ideal conditions
        if (!selectedPreset) {
          message.error("Please select a plant type");
          return;
        }

        const presetResponse = await fetch(`/api/plants?presets=true&plant=${selectedPreset.plant_name}&stage=${dropdownStage}`);
        const presetData = await presetResponse.json();
        idealConditionsToUse = presetData.ideal_conditions || selectedPreset.ideal_conditions;
      }

      const response = await fetch("/api/plants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plant_name: values.customPlantName,
          preset_type: isCustomPlant ? "custom" : selectedPreset.plant_name,
          stage: dropdownStage,
          ideal_conditions: idealConditionsToUse,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedPlant(data.plant.plant_name);
        setSelectedStage(dropdownStage);
        setNewStage(dropdownStage);
        localStorage.setItem("selectedPlant", data.plant.plant_name);
        localStorage.setItem("selectedStage", dropdownStage);
        setShowPlantModal(false);
        setIsCustomPlant(false);
        form.resetFields();
        message.success(`${values.customPlantName} created successfully!`);
      } else {
        message.error("Failed to create plant");
      }
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
      if (response.ok) {
        setSelectedPlant(plantName);
        setSelectedStage(stageName);
        setNewStage(stageName);
        localStorage.setItem("selectedPlant", plantName);
        localStorage.setItem("selectedStage", stageName);
        message.success(`${plantName} (${stageName}) selected successfully!`);
      } else {
        console.error("Failed to save plant selection/stage update.");
        message.error("Failed to save plant selection");
      }
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
      const response = await fetch("/api/sensordata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "abort_plant" }),
      });

      if (response.ok) {
        setSelectedPlant(null);
        setSelectedStage(null);
        localStorage.removeItem("selectedPlant");
        localStorage.removeItem("selectedStage");
        setSensorData({});
        setIdealConditions({});
        setDropdownStage("seedling");
        setNewStage("seedling");
        setShowPlantModal(true);
        message.success("Plant aborted successfully");
      } else {
        console.error("Failed to abort plant.");
        message.error("Failed to abort plant");
      }
    } catch (error) {
      console.error("Request failed:", error);
      message.error("Error aborting plant");
    }
  };

  const fetchHistoricalData = async () => {
    setGraphLoading(true);
    try {
      const response = await fetch("/api/sensordata?growth=true");
      const data = await response.json();
      setHistoricalData(data.historicalData);
      setShowGraphModal(true);
    } catch (error) {
      console.error("Failed to fetch historical data:", error);
      message.error("Failed to load growth data");
    } finally {
      setGraphLoading(false);
    }
  };

  const GrowthModal = () => (
    <div className={styles.graphModal}>
      <div className={styles.graphModalContent}>
        <button
          onClick={() => setShowGraphModal(false)}
          className={styles.graphModalClose}
        >
          &times;
        </button>
        <GrowthGraph data={historicalData} />
      </div>
    </div>
  );

  const PlantCreationModal = () => (
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
      closable={true}
      maskClosable={true}
    >
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        
        <Title level={2} style={{ marginBottom: '8px' }}>
          🌱 Create Your Plant
        </Title>
        
        <Paragraph style={{ fontSize: '16px', color: '#6b7280', marginBottom: '32px' }}>
          Choose a plant preset or create a custom configuration.
        </Paragraph>

        <Form
          form={form}
          layout="vertical"
          style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'left' }}
        >
          <Form.Item
            name="customPlantName"
            label={<Text strong>Plant Name</Text>}
            rules={[{ required: true, message: 'Please enter a name for your plant' }]}
          >
            <Input
              size="large"
              placeholder="e.g., My Pothos Plant"
            />
          </Form.Item>

          <Form.Item
            label={<Text strong>Configuration Type</Text>}
            required
          >
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
                  const preset = availablePresets.find(p => p.plant_name === value);
                  setSelectedPreset(preset);
                }
              }}
              style={{ width: '100%' }}
            >
              {availablePresets.map((preset) => (
                <Option key={preset._id} value={preset.plant_name}>
                  {preset.plant_name.charAt(0).toUpperCase() + preset.plant_name.slice(1)}
                </Option>
              ))}
              <Option value="custom">
                Custom Configuration
              </Option>
            </Select>
          </Form.Item>

          {isCustomPlant && (
            <>
              <Alert
                message="Custom Plant Configuration"
                description="Set your ideal environmental ranges for optimal growth. The system will monitor and alert you when values fall outside these ranges."
                type="info"
                showIcon
                style={{ marginBottom: '16px' }}
              />

              <Title level={5}>Temperature Range (°C)</Title>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Minimum">
                    <InputNumber
                      style={{ width: '100%' }}
                      value={customIdealConditions.temp_min}
                      onChange={(value) => setCustomIdealConditions({...customIdealConditions, temp_min: value})}
                      min={10}
                      max={40}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Maximum">
                    <InputNumber
                      style={{ width: '100%' }}
                      value={customIdealConditions.temp_max}
                      onChange={(value) => setCustomIdealConditions({...customIdealConditions, temp_max: value})}
                      min={10}
                      max={40}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Title level={5}>Humidity Range (%)</Title>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Minimum">
                    <InputNumber
                      style={{ width: '100%' }}
                      value={customIdealConditions.humidity_min}
                      onChange={(value) => setCustomIdealConditions({...customIdealConditions, humidity_min: value})}
                      min={0}
                      max={100}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Maximum">
                    <InputNumber
                      style={{ width: '100%' }}
                      value={customIdealConditions.humidity_max}
                      onChange={(value) => setCustomIdealConditions({...customIdealConditions, humidity_max: value})}
                      min={0}
                      max={100}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Title level={5}>pH Range</Title>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Minimum">
                    <InputNumber
                      style={{ width: '100%' }}
                      value={customIdealConditions.ph_min}
                      onChange={(value) => setCustomIdealConditions({...customIdealConditions, ph_min: value})}
                      min={0}
                      max={14}
                      step={0.1}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Maximum">
                    <InputNumber
                      style={{ width: '100%' }}
                      value={customIdealConditions.ph_max}
                      onChange={(value) => setCustomIdealConditions({...customIdealConditions, ph_max: value})}
                      min={0}
                      max={14}
                      step={0.1}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Title level={5}>PPM Range (Nutrients)</Title>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Minimum">
                    <InputNumber
                      style={{ width: '100%' }}
                      value={customIdealConditions.ppm_min}
                      onChange={(value) => setCustomIdealConditions({...customIdealConditions, ppm_min: value})}
                      min={0}
                      max={5000}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Maximum">
                    <InputNumber
                      style={{ width: '100%' }}
                      value={customIdealConditions.ppm_max}
                      onChange={(value) => setCustomIdealConditions({...customIdealConditions, ppm_max: value})}
                      min={0}
                      max={5000}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Title level={5}>Light PWM Cycle (%)</Title>
              <Form.Item>
                <InputNumber
                  style={{ width: '100%' }}
                  value={customIdealConditions.light_pwm_cycle}
                  onChange={(value) => setCustomIdealConditions({...customIdealConditions, light_pwm_cycle: value})}
                  min={0}
                  max={100}
                />
              </Form.Item>
            </>
          )}

          <Form.Item
            label={
              <Text strong style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Growth Stage
                <Tooltip 
                  title="Our kit groups plant growth into 3 broad stages. Click to learn more about each stage."
                  placement="right"
                >
                  <a
                    href="https://www.saferbrand.com/articles/plant-growth-stages"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#10b981' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FaInfoCircle />
                  </a>
                </Tooltip>
              </Text>
            }
          >
            <Select
              size="large"
              value={dropdownStage}
              onChange={(value) => setDropdownStage(value)}
              style={{ width: '100%' }}
            >
              {GROWTH_STAGES.map((stage) => (
                <Option key={stage} value={stage}>
                  {stage === 'seedling'}
                  {stage === 'vegetative' }
                  {stage === 'mature' }
                  {' '}
                  {stage.charAt(0).toUpperCase() + stage.slice(1)} Stage
                </Option>
              ))}
            </Select>
          </Form.Item>

          {!isCustomPlant && (
            <>
              <Divider style={{ margin: '16px 0' }} />
              <Alert
                message="Setup Instructions"
                description="Ensure the hydroponics tank is filled to the marked range with distilled water before starting. Add more water as required during operation."
                type="info"
                showIcon
                style={{ marginBottom: '16px' }}
              />
            </>
          )}

          <Button
            type="primary"
            size="large"

            onClick={handleCreatePlant}
            block
            style={{ 
              height: '48px',
              fontSize: '16px',
              fontWeight: 'bold',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: 'none',
              marginTop: '16px'
            }}
          >
            Create & Start Monitoring
          </Button>
        </Form>
      </div>
    </Modal>
  );

  if (status === "loading") {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const headerText = selectedPlant && selectedStage
    ? `${selectedPlant.charAt(0).toUpperCase() + selectedPlant.slice(1)} - ${
        selectedStage.charAt(0).toUpperCase() + selectedStage.slice(1)
      } Stage`
    : "Plant Dashboard";

  const { _id, timestamp, pump, light, tds, distance, ...sensors } = sensorData;
  const { light_pwm_cycle, ...idealRanges } = idealConditions || {};

  return (
    <div className={styles.container}>
      <Navbar session={session} />

      <main className={styles.main}>
        <Card className={styles.welcomeCard}>
          <div className={styles.welcomeContent}>
            <Avatar
              src={session.user?.image}
              size={64}
              className={styles.avatar}
            />
            <div>
              <h2 className={styles.welcomeTitle}>
                Welcome back, {session.user?.name || "User"}!
              </h2>
              <p className={styles.welcomeEmail}>{session.user?.email}</p>
            </div>
          </div>
        </Card>

        <Card title="Account Information" className={styles.accountCard}>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Name</p>
              <p className={styles.infoValue}>
                {session.user?.name || "Not provided"}
              </p>
            </div>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Email</p>
              <p className={styles.infoValue}>
                {session.user?.email || "Not provided"}
              </p>
            </div>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Account Id</p>
              <p className={styles.infoValue}>{session.user.id}</p>
            </div>
          </div>
        </Card>

        {/* Main Dashboard Card */}
        <div className={styles.dashboardCard}>
          <div className={styles.dashboardHeader}>
            <h1 className={styles.dashboardTitle}>{headerText}</h1>
          </div>

          {selectedPlant && selectedStage ? (
            /* Sensor Monitoring View */
            <>
              <p className={styles.lastUpdated}>
                Last updated: {lastUpdated}
              </p>

              {/* Sensor Cards Section */}
              <div className={styles.sensorGrid}>
                {Object.keys(sensors).map((key) => {
                  const value = sensors[key];
                  const status = sensorStatus[key] || "Loading...";

                  let statusClass = styles.ideal;
                  let valueDisplay;

                  if (key === "water_sufficient") {
                    valueDisplay = value ? "IDEAL" : "TOO LOW";
                    statusClass = value ? styles.ideal : styles.warning;
                  } else if (key === "ppm" && status === "DILUTE_WATER") {
                    valueDisplay =
                      value !== null ? parseFloat(value).toFixed(2) : "Loading...";
                    statusClass = styles.dilute;
                  } else {
                    valueDisplay =
                      value !== null
                        ? typeof value === "number"
                          ? parseFloat(value).toFixed(2)
                          : value
                        : "Loading...";
                    statusClass = status === "IDEAL" ? styles.ideal : styles.warning;
                  }

                  return (
                    <div key={key} className={styles.sensorCardWrapper}>
                      <div className={styles.sensorCard}>
                        <div className={styles.sensorName}>
                          {sensorNames[key] || key}
                        </div>

                        <div className={`${styles.sensorValue} ${statusClass}`}>
                          {valueDisplay}
                        </div>

                        <div className={styles.idealRange}>
                          Ideal:{" "}
                          {key === "temperature"
                            ? `${idealRanges?.temp_min}°C – ${idealRanges?.temp_max}°C`
                            : key === "humidity"
                            ? `${idealRanges?.humidity_min}% – ${idealRanges?.humidity_max}%`
                            : key === "ph"
                            ? `${idealRanges?.ph_min} – ${idealRanges?.ph_max}`
                            : key === "ppm"
                            ? `${idealRanges?.ppm_min} – ${idealRanges?.ppm_max}`
                            : key === "water_sufficient"
                            ? "Sufficient"
                            : "Range N/A"}
                        </div>
                      </div>

                      {/* PPM DILUTION WARNING */}
                      {key === "ppm" && status === "DILUTE_WATER" && (
                        <div className={styles.ppmWarning}>
                          <FaExclamationTriangle className={styles.ppmWarningIcon} />
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

              {/* Abort Button */}
              <div className={styles.abortSection}>
                <Button
                  danger
                  size="large"
                  onClick={handleAbortPlant}
                  style={{ fontWeight: 'bold' }}
                >
                  Abort Plant
                </Button>
              </div>
            </>
          ) : (
            /* Empty State */
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <FaLeaf style={{ fontSize: '64px', color: '#d1d5db', marginBottom: '24px' }} />
              <Title level={3} style={{ color: '#9ca3af', marginBottom: '16px' }}>
                No Plant Selected
              </Title>
              <Paragraph style={{ color: '#6b7280', marginBottom: '24px' }}>
                Create a plant to start monitoring your smart garden
              </Paragraph>
              <Button
                type="primary"
                size="large"
                onClick={() => setShowPlantModal(true)}
                style={{ 
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  border: 'none',
                  fontWeight: 'bold'
                }}
              >
                Create Plant
              </Button>
            </div>
          )}
        </div>

        {/* Utility Bar - Only show when plant is selected */}
        {selectedPlant && selectedStage && (
          <div className={styles.utilityBar}>
            {/* View Growth Button Card */}
            <div className={styles.utilityCardLeft}>
              <div className={styles.utilityCard}>
                <Button
                  type="primary"

                  onClick={fetchHistoricalData}
                  loading={graphLoading}
                  style={{ 
                    backgroundColor: '#10b981',
                    borderColor: '#10b981',
                    fontWeight: 'bold'
                  }}
                >
                  {graphLoading ? "Loading Growth..." : "View Growth (7 Days)"}
                </Button>
              </div>
            </div>

            {/* Stage Update Card */}
            <div className={styles.utilityCardRight}>
              <div className={styles.stageUpdateCard}>
                <p className={styles.stageUpdateLabel}>
                  Update Growth Stage:
                </p>
                <div className={styles.stageUpdateControls}>
                  <Select
                    value={newStage}
                    onChange={(value) => setNewStage(value)}
                    style={{ flex: 1 }}
                  >
                    {GROWTH_STAGES.map((stage) => (
                      <Option key={stage} value={stage}>
                        {stage.charAt(0).toUpperCase() + stage.slice(1)} Stage
                      </Option>
                    ))}
                  </Select>
                  <Button
                    type="primary"
                    onClick={handleStageUpdate}
                    style={{ fontWeight: 'bold' }}
                  >
                    Update
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Graph Modal */}
        {showGraphModal && <GrowthModal />}
        
        {/* Plant Creation Modal */}
        <PlantCreationModal />
      </main>
    </div>
  );
}