import React, { useEffect, useMemo, useState } from "react";
import { Modal, Form, InputNumber, Radio, Select, message, Typography, Divider, Space } from "antd";

/**
 * Drop-in AddPlantModal that supports three presets (pothos, mint, monstera)
 * and three stages (seedling, vegetative, mature). For presets, it fetches the
 * ideal conditions from your backend:
 *   GET /api/plants?presets=true&plant=<name>&stage=<stage>
 * Expected response: { plant_name, stage, ideal_conditions: { ... } }
 *
 * Props:
 * - visible: boolean
 * - mode: 'create' | 'edit'
 * - initial: optional initial plant object when editing
 * - onCancel: () => void
 * - onSubmit: (payload) => void  // payload contains { plant_name, stage, ideal_conditions }
 */

const { Text } = Typography;

const GROWTH_STAGES = ["seedling", "vegetative", "mature"];
const PRESET_PLANTS = ["pothos", "mint", "monstera"];

const fetchPresetFromDB = async (plant, stage) => {
  const res = await fetch(`/api/plants?presets=true&plant=${encodeURIComponent(plant)}&stage=${encodeURIComponent(stage)}`);
  if (!res.ok) throw new Error("Preset not found in DB");
  const data = await res.json();
  return data.ideal_conditions || {};
};

export default function AddPlantModal({ visible, mode = "create", initial = null, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const [configType, setConfigType] = useState("custom"); // 'custom' | 'pothos' | 'mint' | 'monstera'
  const [stage, setStage] = useState("vegetative");
  const [loadingPreset, setLoadingPreset] = useState(false);

  // Initialize config type and stage when modal opens
  useEffect(() => {
    if (!visible) return;

    // Determine default config type
    if (mode === "edit" && initial?.plant_name) {
      const lower = String(initial.plant_name).toLowerCase();
      if (PRESET_PLANTS.includes(lower)) {
        setConfigType(lower);
      } else {
        setConfigType("custom");
      }
    } else {
      setConfigType("custom");
    }

    // Determine default stage
    if (mode === "edit" && initial?.stage && GROWTH_STAGES.includes(String(initial.stage).toLowerCase())) {
      setStage(String(initial.stage).toLowerCase());
    } else {
      setStage("vegetative");
    }

    // Seed form with initial ideal_conditions if editing custom or if present
    if (mode === "edit" && initial?.ideal_conditions) {
      form.setFieldsValue(initial.ideal_conditions);
    } else {
      form.resetFields();
    }
  }, [visible, mode, initial, form]);

  // Prefill from MongoDB whenever configType or stage changes (for non-custom)
  useEffect(() => {
    if (!visible) return;
    if (configType === "custom") return; // user will enter their own values

    let mounted = true;
    setLoadingPreset(true);
    fetchPresetFromDB(configType, stage)
      .then((cond) => {
        if (!mounted) return;
        form.setFieldsValue(cond);
      })
      .catch(() => {
        if (!mounted) return;
        message.warning(`No preset for ${configType}/${stage} found in MongoDB`);
        form.resetFields();
      })
      .finally(() => mounted && setLoadingPreset(false));

    return () => {
      mounted = false;
    };
  }, [configType, stage, visible, form]);

  const plantName = useMemo(() => (configType === "custom" ? "custom" : configType), [configType]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        plant_name: plantName,
        stage,
        ideal_conditions: {
          ph_min: values.ph_min ?? null,
          ph_max: values.ph_max ?? null,
          ppm_min: values.ppm_min ?? null,
          ppm_max: values.ppm_max ?? null,
          temp_min: values.temp_min ?? null,
          temp_max: values.temp_max ?? null,
          humidity_min: values.humidity_min ?? null,
          humidity_max: values.humidity_max ?? null,
          light_pwm_cycle: values.light_pwm_cycle ?? null,
        },
      };

      // Bubble up to parent (parent can POST /api/plants and/or /api/sensordata)
      onSubmit?.(payload);
    } catch (e) {
      // AntD will highlight invalid fields
    }
  };

  const title = mode === "edit" ? "Edit Plant" : "Create Plant";

  return (
    <Modal
      open={visible}
      title={title}
      onCancel={onCancel}
      onOk={handleOk}
      okText={mode === "edit" ? "Save" : "Create"}
      confirmLoading={loadingPreset}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Text strong>Configuration</Text>
          <Radio.Group
            style={{ display: "block", marginTop: 8 }}
            value={configType}
            onChange={(e) => setConfigType(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="custom">Custom</Radio.Button>
            <Radio.Button value="pothos">Pothos</Radio.Button>
            <Radio.Button value="mint">Mint</Radio.Button>
            <Radio.Button value="monstera">Monstera</Radio.Button>
          </Radio.Group>
        </div>

        <div>
          <Text strong>Growth Stage</Text>
          <Select
            style={{ width: "100%", marginTop: 8 }}
            value={stage}
            onChange={(v) => setStage(v)}
            options={GROWTH_STAGES.map((s) => ({ label: s, value: s }))}
          />
        </div>

        <Divider style={{ margin: "8px 0" }} />

        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="pH Min" name="ph_min" rules={[{ required: true, message: "Enter pH min" }]}> 
            <InputNumber style={{ width: "100%" }} step={0.1} min={0} max={14} />
          </Form.Item>
          <Form.Item label="pH Max" name="ph_max" rules={[{ required: true, message: "Enter pH max" }]}> 
            <InputNumber style={{ width: "100%" }} step={0.1} min={0} max={14} />
          </Form.Item>

          <Form.Item label="PPM Min" name="ppm_min" rules={[{ required: true, message: "Enter PPM min" }]}> 
            <InputNumber style={{ width: "100%" }} step={10} min={0} />
          </Form.Item>
          <Form.Item label="PPM Max" name="ppm_max" rules={[{ required: true, message: "Enter PPM max" }]}> 
            <InputNumber style={{ width: "100%" }} step={10} min={0} />
          </Form.Item>

          <Form.Item label="Temp Min (°C)" name="temp_min" rules={[{ required: true, message: "Enter temp min" }]}> 
            <InputNumber style={{ width: "100%" }} step={0.5} />
          </Form.Item>
          <Form.Item label="Temp Max (°C)" name="temp_max" rules={[{ required: true, message: "Enter temp max" }]}> 
            <InputNumber style={{ width: "100%" }} step={0.5} />
          </Form.Item>

          <Form.Item label="Humidity Min (%)" name="humidity_min" rules={[{ required: true, message: "Enter humidity min" }]}> 
            <InputNumber style={{ width: "100%" }} step={1} min={0} max={100} />
          </Form.Item>
          <Form.Item label="Humidity Max (%)" name="humidity_max" rules={[{ required: true, message: "Enter humidity max" }]}> 
            <InputNumber style={{ width: "100%" }} step={1} min={0} max={100} />
          </Form.Item>

          <Form.Item label="Light PWM Cycle (hours on)" name="light_pwm_cycle" rules={[{ required: true, message: "Enter light hours" }]}> 
            <InputNumber style={{ width: "100%" }} step={1} min={0} max={24} />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
