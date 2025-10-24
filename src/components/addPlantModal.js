'use client';

import { useState } from 'react';
import { Modal, Form, Input, InputNumber, Select, Button, message, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

const { Option } = Select;

export default function AddPlantModal({ visible, onClose, onSuccess }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const stages = ['seedling', 'vegetative', 'flowering', 'mature', 'harvest'];

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      // Construct the plant profile object
      const plantProfile = {
        plant_name: values.plant_name.toLowerCase().trim(),
        stage: values.stage,
        ideal_conditions: {
          ph_min: parseFloat(values.ph_min),
          ph_max: parseFloat(values.ph_max),
          ppm_min: parseInt(values.ppm_min),
          ppm_max: parseInt(values.ppm_max),
          temp_min: parseFloat(values.temp_min),
          temp_max: parseFloat(values.temp_max),
          humidity_min: parseInt(values.humidity_min),
          humidity_max: parseInt(values.humidity_max),
          light_pwm_cycle: parseInt(values.light_pwm_cycle),
          ideal_light_distance_cm: parseInt(values.ideal_light_distance_cm),
          light_distance_tolerance_cm: parseInt(values.light_distance_tolerance_cm)
        }
      };

      // Send to API
      const response = await fetch('/api/plants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(plantProfile),
      });

      if (!response.ok) {
        throw new Error('Failed to add plant');
      }

      message.success('Plant profile added successfully!');
      form.resetFields();
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error adding plant:', error);
      message.error('Failed to add plant profile');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

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