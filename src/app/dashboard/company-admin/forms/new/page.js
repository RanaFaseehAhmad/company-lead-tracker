'use client';

import FormBuilder from '@/components/FormBuilder';
import DashboardLayout from '@/components/DashboardLayout';

export default function NewFormPage() {
  return (
    <DashboardLayout
      breadcrumbs={[
        { label: 'Lead Forms', href: '/dashboard/company-admin/forms' },
        { label: 'New Form' },
      ]}
      fullWidth={true}
    >
      <FormBuilder initialFormId={null} />
    </DashboardLayout>
  );
}
