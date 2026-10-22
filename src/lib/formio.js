/**
 * Legacy Form.io Adapter (Deprecated)
 * Form.io has been replaced with the native custom form engine.
 * This adapter safely redirects to native helpers in src/lib/forms.js.
 */

export * from './forms';

export function isFormioConfigured() {
  return false;
}

export function getDefaultFormioSchema(title = 'Lead Capture Form') {
  return {
    display: 'form',
    title,
    components: [],
  };
}

export function convertCustomFieldsToFormio(fields, title) {
  return {
    display: 'form',
    title: title || 'Lead Capture Form',
    components: (fields || []).map((f) => ({
      key: f.name || f.id,
      label: f.label,
      type: f.type,
      validate: { required: Boolean(f.required) },
    })),
  };
}

export function convertFormioToCustomFields(schema) {
  return [];
}

export function getFormioInputComponents(schema) {
  return [];
}

export async function syncExternalFormioProject() {
  return null;
}

export function verifyFormioWebhook() {
  return false;
}
