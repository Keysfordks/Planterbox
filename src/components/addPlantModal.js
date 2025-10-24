'use client';

import React, { useState } from 'react';
import { Modal, Form, Input, InputNumber, Select, Button, message } from 'antd';
import { useRouter } from 'next/navigation';

const STAGES = ['seedling', 'vegetative', 'flowering', 'fruiting'];

export default function AddPlantModal({ open, onClose }) {
  const [form] = Form.useForm();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (values) => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const payload = {
        plant_name: values.plant_name,
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
          light_pwm_cycle: Number(values.light_pwm_cycle),
        },
      };

      await fetch('/api/plants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      message.success('Plant created — redirecting...');
      form.resetFields();
      onClose?.();

      // force navigation to dashboard
      router.push('/dashboard');
      router.refresh?.();

    } catch (err) {
      console.error('Error creating plant:', err);
      message.error('Something went wrong, but redirecting anyway...');
      router.push('/dashboard');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Create Plant Profile"
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose?.();
      }}
      footer={null}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item label="Plant Name" name="plant_name" required>
          <Input />
        </Form.Item>

        <Form.Item label="Stage" name="stage" required>
          <Select options={STAGES.map((s) => ({ label: s, value: s }))} />
        </Form.Item>

        <Form.Item label="Temperature Min (°C)" name="temp_min" required>
          <InputNumber style={{ width: '100%' }} step={0.1} />
        </Form.Item>

        <Form.Item label="Temperature Max (°C)" name="temp_max" required>
          <InputNumber style={{ width: '100%' }} step={0.1} />
        </Form.Item>

        <Form.Item label="Humidity Min (%)" name="humidity_min" required>
          <InputNumber style={{ width: '100%' }} min={0} max={100} />
        </Form.Item>

        <Form.Item label="Humidity Max (%)" name="humidity_max" required>
          <InputNumber style={{ width: '100%' }} min={0} max={100} />
        </Form.Item>

        <Form.Item label="pH Min" name="ph_min" required>
          <InputNumber style={{ width: '100%' }} step={0.01} precision={2} min={0} max={14} />
        </Form.Item>

        <Form.Item label="pH Max" name="ph_max" required>
          <InputNumber style={{ width: '100%' }} step={0.01} precision={2} min={0} max={14} />
        </Form.Item>

        <Form.Item label="PPM Min" name="ppm_min" required>
          <InputNumber style={{ width: '100%' }} step={10} min={0} />
        </Form.Item>

        <Form.Item label="PPM Max" name="ppm_max" required>
          <InputNumber style={{ width: '100%' }} step={10} min={0} />
        </Form.Item>

        <Form.Item label="Light Hours Per Day" name="light_pwm_cycle" required>
          <InputNumber style={{ width: '100%' }} step={0.5} min={0} max={24} />
        </Form.Item>

        <Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              Create & Go to Dashboard
            </Button>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}
