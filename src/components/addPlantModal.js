'use client';
import { useState } from 'react';
import { message } from 'antd';

export default function AddPlantModal(props) {
  const [submitting, setSubmitting] = useState(false);

  async function handleCreatePlant(values) {
    try {
      setSubmitting(true);

      const payload = {
        plant_name: (values.plant_name || '').trim(),
        stage: values.stage,
        ideal_conditions: {
          temp_min: Number(values.temp_min),
          temp_max: Number(values.temp_max),
          humidity_min: Number(values.humidity_min),
          humidity_max: Number(values.humidity_max),
          ph_min: Number(values.ph_min),
          ph_max: Number(values.ph_max),
          ppm_min: Number(values.ppm_min),
          ppm_max: Number(values.ppm_max),
          // hours/day per your intent; keep the key name your app already uses
          light_pwm_cycle: Number(values.light_pwm_cycle),
        },
      };

      // Minimal validation to avoid NaN
      for (const [k, v] of Object.entries(payload.ideal_conditions)) {
        if (Number.isNaN(v)) {
          throw new Error(`Field "${k}" must be a number`);
        }
      }
      if (!payload.plant_name || !payload.stage) {
        throw new Error('Plant name and stage are required');
      }

      const res = await fetch('/api/plants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // IMPORTANT: don’t call res.json() if res.ok is false (HTML error page will crash JSON.parse)
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Create failed (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      message.success('Plant profile created');
      props.onSuccess?.(data);
      props.onClose?.();
    } catch (err) {
      console.error('AddPlantModal create error:', err);
      message.error(err.message || 'Could not create plant. Are you signed in?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Add New Plant Profile"
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={loading}
          onClick={handleSubmit}
          icon={<PlusOutlined />}
        >
          Add Plant
        </Button>,
      ]}
      width={700}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          light_pwm_cycle: 12,
          ideal_light_distance_cm: 15,
          light_distance_tolerance_cm: 2
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Basic Information */}
          <div>
            <h3 style={{ marginBottom: '1rem', color: '#667eea' }}>Basic Information</h3>
            <Form.Item
              name="plant_name"
              label="Plant Name"
              rules={[{ required: true, message: 'Please enter plant name' }]}
            >
              <Input placeholder="e.g., Pothos, Basil, Tomato" />
            </Form.Item>

            <Form.Item
              name="stage"
              label="Growth Stage"
              rules={[{ required: true, message: 'Please select growth stage' }]}
            >
              <Select placeholder="Select growth stage">
                {stages.map(stage => (
                  <Option key={stage} value={stage}>
                    {stage.charAt(0).toUpperCase() + stage.slice(1)}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </div>

          {/* pH Range */}
          <div>
            <h3 style={{ marginBottom: '1rem', color: '#667eea' }}>pH Range</h3>
            <Space style={{ width: '100%' }}>
              <Form.Item
                name="ph_min"
                label="Minimum pH"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={14}
                  step={0.1}
                  placeholder="5.5"
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="ph_max"
                label="Maximum pH"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={14}
                  step={0.1}
                  placeholder="6.5"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Space>
          </div>

          {/* PPM Range */}
          <div>
            <h3 style={{ marginBottom: '1rem', color: '#667eea' }}>PPM (Nutrient) Range</h3>
            <Space style={{ width: '100%' }}>
              <Form.Item
                name="ppm_min"
                label="Minimum PPM"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={5000}
                  step={50}
                  placeholder="200"
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="ppm_max"
                label="Maximum PPM"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={5000}
                  step={50}
                  placeholder="400"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Space>
          </div>

          {/* Temperature Range */}
          <div>
            <h3 style={{ marginBottom: '1rem', color: '#667eea' }}>Temperature Range (°C)</h3>
            <Space style={{ width: '100%' }}>
              <Form.Item
                name="temp_min"
                label="Minimum Temperature"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={50}
                  step={0.5}
                  placeholder="20"
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="temp_max"
                label="Maximum Temperature"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={50}
                  step={0.5}
                  placeholder="28"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Space>
          </div>

          {/* Humidity Range */}
          <div>
            <h3 style={{ marginBottom: '1rem', color: '#667eea' }}>Humidity Range (%)</h3>
            <Space style={{ width: '100%' }}>
              <Form.Item
                name="humidity_min"
                label="Minimum Humidity"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={100}
                  step={5}
                  placeholder="60"
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="humidity_max"
                label="Maximum Humidity"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={100}
                  step={5}
                  placeholder="80"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Space>
          </div>

          {/* Light Settings */}
          <div>
            <h3 style={{ marginBottom: '1rem', color: '#667eea' }}>Light Settings</h3>
            <Form.Item
              name="light_pwm_cycle"
              label="Light Cycle (hours per day)"
              rules={[{ required: true, message: 'Required' }]}
            >
              <InputNumber
                min={0}
                max={24}
                step={1}
                placeholder="12"
                style={{ width: '100%' }}
              />
            </Form.Item>

            <Space style={{ width: '100%' }}>
              <Form.Item
                name="ideal_light_distance_cm"
                label="Ideal Light Distance (cm)"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={200}
                  step={1}
                  placeholder="15"
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="light_distance_tolerance_cm"
                label="Distance Tolerance (±cm)"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  min={0}
                  max={50}
                  step={1}
                  placeholder="2"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Space>
          </div>
        </Space>
      </Form>
    </Modal>
  );
}