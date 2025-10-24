'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, InputNumber, Select, Button, Space, message, Radio } from 'antd';

/**
 * AddPlantModal
 * - "Configuration Type": Pothos | Monstera | Mint | Custom
 * - Choose Growth Stage (seedling, vegetative, flowering, mature, harvest)
 * - Prefills parameters from PRESET_MAP when a preset + stage exists
 * - Works for both "create" (default) and "edit" modes
 *
 * Props:
 *  - visible: boolean
 *  - onClose: () => void
 *  - onSuccess?: () => void
 *  - deviceId?: string
 *  - mode?: 'create' | 'edit'
 *  - initial?: { plant_name: string, stage: string, ideal_conditions: {...} }
 */

const { Option } = Select;

// Keep in sync with your page.js stages:
const GROWTH_STAGES = ['seedling', 'vegetative', 'flowering', 'mature', 'harvest'];

// Curated presets (fill more stages/values as you curate them)
const PRESET_MAP = {
  pothos: {
    // seedling: { ... },
    // vegetative: { ... },
    // flowering: { ... },
  },
  monstera: {
    // Example payload you provided for vegetative:
    vegetative: {
      ph_min: 5.5,
      ph_max: 6.5,
      ppm_min: 700,
      ppm_max: 1200,
      temp_min: 21.0,
      temp_max: 27.0,
      humidity_min: 60,
      humidity_max: 80,
      light_pwm_cycle: 14,
    },
  },
  mint: {
    // seedling: { ... },
    // vegetative: { ... },
    // flowering: { ... },
  },
};

export default function AddPlantModal({
  visible,
  onClose,
  onSuccess,
  deviceId,
  mode = 'create',
  initial = null,
}) {
  const [form] = Form.useForm();

  // Config type (preset or custom)
  const [configType, setConfigType] = useState('custom');
  const [stage, setStage] = useState('seedling');

  // Infer config type on open when editing
  useEffect(() => {
    if (!visible) return;
    if (mode === 'edit' && initial?.plant_name) {
      const lower = String(initial.plant_name).toLowerCase();
      if (['pothos', 'monstera', 'mint'].includes(lower)) {
        setConfigType(lower);
      } else {
        setConfigType('custom');
      }
    } else {
      setConfigType('custom');
    }
  }, [visible, mode, initial?.plant_name]);

  // Set initial stage + values on open
  useEffect(() => {
    if (!visible) return;

    const st = (mode === 'edit' && initial?.stage) ? initial.stage : 'seedling';
    setStage(st);

    const base = (mode === 'edit' && initial?.ideal_conditions) ? initial.ideal_conditions : {};
    form.setFieldsValue({
      temp_min: base.temp_min ?? undefined,
      temp_max: base.temp_max ?? undefined,
      humidity_min: base.humidity_min ?? undefined,
      humidity_max: base.humidity_max ?? undefined,
      ph_min: base.ph_min ?? undefined,
      ph_max: base.ph_max ?? undefined,
      ppm_min: base.ppm_min ?? undefined,
      ppm_max: base.ppm_max ?? undefined,
      light_pwm_cycle: base.light_pwm_cycle ?? undefined,
      ideal_light_distance_cm: base.ideal_light_distance_cm ?? undefined,
      light_distance_tolerance_cm: base.light_distance_tolerance_cm ?? undefined,
    });
  }, [visible, mode, initial, form]);

  // Prefill from preset whenever configType or stage changes
  useEffect(() => {
    if (!visible) return;
    if (configType !== 'custom') {
      const preset = PRESET_MAP?.[configType]?.[stage];
      if (preset) {
        form.setFieldsValue(preset);
      }
    }
  }, [configType, stage, visible, form]);

  const plantName = useMemo(() => {
    if (configType === 'custom') return 'custom';
    return configType; // pothos | monstera | mint
  }, [configType]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      // Construct payload for the selected stage
      const payload = {
        plant_name: plantName,
        stage,
        ideal_conditions: {
          temp_min: values.temp_min,
          temp_max: values.temp_max,
          humidity_min: values.humidity_min,
          humidity_max: values.humidity_max,
          ph_min: values.ph_min,
          ph_max: values.ph_max,
          ppm_min: values.ppm_min,
          ppm_max: values.ppm_max,
          light_pwm_cycle: values.light_pwm_cycle,
          ideal_light_distance_cm: values.ideal_light_distance_cm,
          light_distance_tolerance_cm: values.light_distance_tolerance_cm,
        },
        deviceId: deviceId || undefined,
      };

      // Create/update the profile (expects /api/plants POST for create, PUT for edit)
      const res = await fetch('/api/plants', {
        method: mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || 'Failed to save plant profile');
      }

      // On create, also select it as the active plant
      if (mode === 'create') {
        const sel = await fetch('/api/sensordata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'select_plant',
            selectedPlant: plantName,
            selectedStage: stage,
          }),
        });
        if (!sel.ok) throw new Error('Failed to select plant');
      }

      message.success(mode === 'edit' ? 'Parameters updated' : 'Plant created');
      onClose?.();
      onSuccess?.();
    } catch (e) {
      console.error(e);
      message.error(e?.message || 'Unable to save');
    }
  };

  return (
    <Modal
      title={mode === 'edit' ? 'Edit Plant Parameters' : 'Create Your Plant'}
      open={visible}
      onCancel={onClose}
      width={720}
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={handleSubmit}>
            {mode === 'edit' ? 'Save Changes' : 'Create & Start Monitoring'}
          </Button>
        </Space>
      }
      destroyOnClose={false}
      maskClosable={false}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Configuration Type */}
        <div>
          <h3 style={{ marginBottom: 8 }}>Configuration Type</h3>
          <Radio.Group
            value={configType}
            onChange={(e) => setConfigType(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="pothos">Pothos</Radio.Button>
            <Radio.Button value="monstera">Monstera</Radio.Button>
            <Radio.Button value="mint">Mint</Radio.Button>
            <Radio.Button value="custom">Custom</Radio.Button>
          </Radio.Group>
        </div>

        {/* Growth Stage */}
        <div>
          <h3 style={{ marginBottom: 8 }}>Growth Stage</h3>
          <Select value={stage} onChange={setStage} style={{ minWidth: 220 }}>
            {GROWTH_STAGES.map((s) => (
              <Option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Option>
            ))}
          </Select>
        </div>

        {/* Parameters */}
        <Form form={form} layout="vertical">
          {/* PPM */}
          <div>
            <h3 style={{ marginBottom: '0.5rem' }}>PPM Range (Nutrients)</h3>
            <Space style={{ width: '100%' }}>
              <Form.Item name="ppm_min" label="Minimum PPM" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber min={0} max={5000} step={50} placeholder="700" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="ppm_max" label="Maximum PPM" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber min={0} max={5000} step={50} placeholder="1200" style={{ width: '100%' }} />
              </Form.Item>
            </Space>
          </div>

          {/* Temperature */}
          <div>
            <h3 style={{ marginBottom: '0.5rem' }}>Temperature Range (°C)</h3>
            <Space style={{ width: '100%' }}>
              <Form.Item name="temp_min" label="Minimum Temperature" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber min={0} max={50} step={0.5} placeholder="21.0" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="temp_max" label="Maximum Temperature" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber min={0} max={50} step={0.5} placeholder="27.0" style={{ width: '100%' }} />
              </Form.Item>
            </Space>
          </div>

          {/* Humidity */}
          <div>
            <h3 style={{ marginBottom: '0.5rem' }}>Humidity Range (%)</h3>
            <Space style={{ width: '100%' }}>
              <Form.Item name="humidity_min" label="Minimum Humidity" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber min={0} max={100} step={1} placeholder="60" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="humidity_max" label="Maximum Humidity" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber min={0} max={100} step={1} placeholder="80" style={{ width: '100%' }} />
              </Form.Item>
            </Space>
          </div>

          {/* pH */}
          <div>
            <h3 style={{ marginBottom: '0.5rem' }}>pH Range</h3>
            <Space style={{ width: '100%' }}>
              <Form.Item name="ph_min" label="Minimum pH" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber min={0} max={14} step={0.1} placeholder="5.5" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="ph_max" label="Maximum pH" rules={[{ required: true, message: 'Required' }]}>
                <InputNumber min={0} max={14} step={0.1} placeholder="6.5" style={{ width: '100%' }} />
              </Form.Item>
            </Space>
          </div>

          {/* Light */}
          <div>
            <h3 style={{ marginBottom: '0.5rem' }}>Light Settings</h3>
            <Form.Item
              name="light_pwm_cycle"
              label="Light Cycle (hours per day)"
              rules={[{ required: true, message: 'Required' }]}
            >
              <InputNumber min={0} max={24} step={1} placeholder="14" style={{ width: '100%' }} />
            </Form.Item>

            <Space style={{ width: '100%' }}>
              <Form.Item name="ideal_light_distance_cm" label="Ideal Light Distance (cm)">
                <InputNumber min={0} max={200} step={1} placeholder="15" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="light_distance_tolerance_cm" label="Distance Tolerance (±cm)">
                <InputNumber min={0} max={200} step={1} placeholder="3" style={{ width: '100%' }} />
              </Form.Item>
            </Space>
          </div>
        </Form>
      </Space>
    </Modal>
  );
}
