'use client';

import React, { useState } from 'react';
import { Modal, Form, Input, InputNumber, Select, Button, message, Alert } from 'antd';

const STAGES = ['seedling', 'vegetative', 'flowering', 'fruiting'];

export default function AddPlantModal({ open, onClose, onSuccess }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  // Cross-field range validator (min ≤ max)
  const rangeRule = (minField, maxField, label) => ({
    validator() {
      const min = form.getFieldValue(minField);
      const max = form.getFieldValue(maxField);
      if (min == null || max == null) return Promise.resolve();
      if (typeof min !== 'number' || typeof max !== 'number' || Number.isNaN(min) || Number.isNaN(max)) {
        return Promise.reject(new Error(`${label}: enter valid numbers.`));
      }
      if (min > max) return Promise.reject(new Error(`${label}: min must be ≤ max.`));
      return Promise.resolve();
    },
  });

  const onFinish = async (values) => {
    setSubmitErr(null);
    try {
      setSubmitting(true);

      // Build payload with explicit coercion
      const toNum = (v) => (typeof v === 'number' ? v : Number(v));
      const payload = {
        plant_name: String(values.plant_name || '').trim(),
        stage: String(values.stage || '').trim(),
        ideal_conditions: {
          temp_min: toNum(values.temp_min),
          temp_max: toNum(values.temp_max),
          humidity_min: toNum(values.humidity_min),
          humidity_max: toNum(values.humidity_max),
          ph_min: toNum(values.ph_min),
          ph_max: toNum(values.ph_max),
          ppm_min: toNum(values.ppm_min),
          ppm_max: toNum(values.ppm_max),
          // HOURS/DAY — your backend treats this as hours per day
          light_pwm_cycle: toNum(values.light_pwm_cycle),
        },
      };

      // Final NaN/empty guard
      if (!payload.plant_name || !payload.stage) {
        throw new Error('Plant name and stage are required.');
      }
      for (const [k, v] of Object.entries(payload.ideal_conditions)) {
        if (typeof v !== 'number' || Number.isNaN(v)) {
          throw new Error(`Field "${k}" must be a valid number.`);
        }
      }

      const res = await fetch('/api/plants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        // Show the server message if it exists (401, 400, etc.)
        throw new Error(`Create failed (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      message.success('Plant profile created.');
      onSuccess?.(data);
      form.resetFields();
      onClose?.();
    } catch (err) {
      console.error('AddPlantModal create error:', err);
      setSubmitErr(err.message || 'Please fill in all required fields or check custom values.');
    } finally {
      setSubmitting(false);
    }
  };

  const onFinishFailed = ({ errorFields }) => {
    setSubmitErr('Please correct the highlighted fields.');
    if (errorFields?.length) {
      form.scrollToField(errorFields[0].name);
    }
  };

  return (
    <Modal
      title="Create Custom Plant Profile"
      open={open}
      onCancel={() => {
        setSubmitErr(null);
        form.resetFields();
        onClose?.();
      }}
      footer={null}
      destroyOnClose
    >
      {submitErr ? (
        <Alert type="error" message={submitErr} style={{ marginBottom: 12 }} />
      ) : null}

      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        onFinishFailed={onFinishFailed}
        validateTrigger={['onChange', 'onBlur']}
      >
        <Form.Item
          label="Plant Name"
          name="plant_name"
          rules={[{ required: true, message: 'Please enter a plant name.' }]}
        >
          <Input placeholder="e.g., Strawberry" />
        </Form.Item>

        <Form.Item
          label="Stage"
          name="stage"
          rules={[{ required: true, message: 'Please select a stage.' }]}
        >
          <Select
            placeholder="Choose stage"
            options={STAGES.map((s) => ({ value: s, label: s }))}
          />
        </Form.Item>

        {/* Temperature */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item
            label="Temperature Min (°C)"
            name="temp_min"
            rules={[
              { required: true, message: 'Enter temperature min.' },
              rangeRule('temp_min', 'temp_max', 'Temperature'),
            ]}
          >
            <InputNumber style={{ width: '100%' }} step={0.1} />
          </Form.Item>
          <Form.Item
            label="Temperature Max (°C)"
            name="temp_max"
            rules={[
              { required: true, message: 'Enter temperature max.' },
              rangeRule('temp_min', 'temp_max', 'Temperature'),
            ]}
          >
            <InputNumber style={{ width: '100%' }} step={0.1} />
          </Form.Item>
        </div>

        {/* Humidity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item
            label="Humidity Min (%)"
            name="humidity_min"
            rules={[
              { required: true, message: 'Enter humidity min.' },
              rangeRule('humidity_min', 'humidity_max', 'Humidity'),
            ]}
          >
            <InputNumber style={{ width: '100%' }} step={1} min={0} max={100} />
          </Form.Item>
          <Form.Item
            label="Humidity Max (%)"
            name="humidity_max"
            rules={[
              { required: true, message: 'Enter humidity max.' },
              rangeRule('humidity_min', 'humidity_max', 'Humidity'),
            ]}
          >
            <InputNumber style={{ width: '100%' }} step={1} min={0} max={100} />
          </Form.Item>
        </div>

        {/* pH (decimals matter) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item
            label="pH Min"
            name="ph_min"
            rules={[
              { required: true, message: 'Enter pH min.' },
              rangeRule('ph_min', 'ph_max', 'pH'),
            ]}
          >
            <InputNumber style={{ width: '100%' }} step={0.01} precision={2} min={0} max={14} />
          </Form.Item>
          <Form.Item
            label="pH Max"
            name="ph_max"
            rules={[
              { required: true, message: 'Enter pH max.' },
              rangeRule('ph_min', 'ph_max', 'pH'),
            ]}
          >
            <InputNumber style={{ width: '100%' }} step={0.01} precision={2} min={0} max={14} />
          </Form.Item>
        </div>

        {/* PPM */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item
            label="PPM Min"
            name="ppm_min"
            rules={[
              { required: true, message: 'Enter PPM min.' },
              rangeRule('ppm_min', 'ppm_max', 'PPM'),
            ]}
          >
            <InputNumber style={{ width: '100%' }} step={10} min={0} />
          </Form.Item>
          <Form.Item
            label="PPM Max"
            name="ppm_max"
            rules={[
              { required: true, message: 'Enter PPM max.' },
              rangeRule('ppm_min', 'ppm_max', 'PPM'),
            ]}
          >
            <InputNumber style={{ width: '100%' }} step={10} min={0} />
          </Form.Item>
        </div>

        {/* Light hours/day */}
        <Form.Item
          label="Light Hours Per Day (0–24)"
          name="light_pwm_cycle"
          rules={[
            { required: true, message: 'Enter light hours per day.' },
            {
              validator(_, v) {
                if (v == null || v === '') return Promise.resolve();
                const num = typeof v === 'number' ? v : Number(v);
                if (Number.isNaN(num)) return Promise.reject(new Error('Must be a number.'));
                if (num < 0 || num > 24) return Promise.reject(new Error('Must be between 0 and 24.'));
                return Promise.resolve();
              }
            }
          ]}
        >
          <InputNumber style={{ width: '100%' }} step={0.5} min={0} max={24} />
        </Form.Item>

        <Form.Item style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              onClick={() => {
                setSubmitErr(null);
                form.resetFields();
                onClose?.();
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              Create Plant
            </Button>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}
