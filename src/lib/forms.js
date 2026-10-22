/**
 * Custom Form Engine Utilities
 * Validates native field configurations, submissions, and maps submissions to Lead entities.
 */

import { ALLOWED_FIELD_TYPES } from '@/models/Form';

const KEY_REGEX = /^[a-z0-9_]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;

/**
 * Generates a clean, unique submission key from a field label.
 */
export function labelToKey(label, fallbackIndex = 0, existingKeys = new Set()) {
  let base = (label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  if (!base) base = `field_${fallbackIndex + 1}`;

  let candidate = base;
  let counter = 2;
  while (existingKeys.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter++;
  }
  return candidate;
}

/**
 * Validates an array of custom field definitions when creating/updating a form.
 * Automatically generates a stable unique key if 'name' is missing or duplicate.
 */
export function validateFields(fields, isPublishing = false) {
  if (!Array.isArray(fields)) {
    return { valid: false, error: 'Fields must be an array.' };
  }

  if (isPublishing && fields.length === 0) {
    return { valid: false, error: 'A form must contain at least one field before it can be published.' };
  }

  if (fields.length > 50) {
    return { valid: false, error: 'A form cannot exceed 50 fields.' };
  }

  const ids = new Set();
  const names = new Set();

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f || typeof f !== 'object') {
      return { valid: false, error: `Invalid field at position ${i + 1}.` };
    }

    const fieldId = (f.id || '').trim();
    if (!fieldId) {
      return { valid: false, error: `Field ID is required at position ${i + 1}.` };
    }
    if (ids.has(fieldId)) {
      return { valid: false, error: `Duplicate field ID: "${fieldId}".` };
    }
    ids.add(fieldId);

    const type = (f.type || '').trim().toLowerCase();
    if (!ALLOWED_FIELD_TYPES.includes(type)) {
      return { valid: false, error: `Unsupported field type "${f.type}" at position ${i + 1}.` };
    }

    const label = (f.label || '').trim();
    if (!label) {
      return { valid: false, error: `Field label is required at position ${i + 1}.` };
    }

    // Auto-derive name if missing or empty
    let name = (f.name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!name) {
      name = labelToKey(label, i, names);
      f.name = name;
    }

    if (!KEY_REGEX.test(name)) {
      return {
        valid: false,
        error: `Submission key "${name}" must contain only lowercase letters, numbers, and underscores.`,
      };
    }

    if (names.has(name)) {
      name = labelToKey(name, i, names);
      f.name = name;
    }
    names.add(name);

    if (type === 'dropdown' || type === 'radio') {
      if (!Array.isArray(f.options) || f.options.length === 0 || f.options.every((o) => !String(o).trim())) {
        return { valid: false, error: `At least one non-empty option is required for ${type} field "${label}".` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates visitor submission data against form fields.
 */
export function validateSubmission(form, rawValues) {
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    return { valid: false, error: 'Submission data must be an object of field values.' };
  }

  const fields = Array.isArray(form?.fields) ? form.fields : [];
  const fieldsMap = {};
  for (const f of fields) {
    const key = (f.name || f.id || '').trim().toLowerCase();
    if (key) {
      fieldsMap[key] = f;
    }
  }

  // Reject unrecognized submission fields
  const submittedKeys = Object.keys(rawValues).filter(
    (k) =>
      k !== 'submit' &&
      k !== 'companyId' &&
      k !== 'formId' &&
      k !== 'publicId' &&
      k !== 'page' &&
      !k.startsWith('_') &&
      k !== 'source' &&
      k !== 'referrer'
  );

  for (const key of submittedKeys) {
    const lowerKey = key.toLowerCase();
    if (!fieldsMap[lowerKey]) {
      return { valid: false, error: `Unrecognized submission field: "${key}".` };
    }
  }

  const sanitizedValues = {};

  for (const [keyName, f] of Object.entries(fieldsMap)) {
    let rawVal = rawValues[f.name];
    if (rawVal === undefined) rawVal = rawValues[keyName];
    if (rawVal === undefined) {
      const found = Object.keys(rawValues).find((k) => k.toLowerCase() === keyName);
      if (found) rawVal = rawValues[found];
    }

    const valStr = typeof rawVal === 'string' ? rawVal.trim() : rawVal;

    // Required check
    if (f.required) {
      if (valStr === undefined || valStr === null || valStr === '' || (f.type === 'checkbox' && valStr === false)) {
        return { valid: false, error: `"${f.label}" is a required field.` };
      }
    }

    if (valStr !== undefined && valStr !== null && valStr !== '') {
      const stringVal = String(valStr).trim();

      // Field length limit
      const maxLen = f.type === 'textarea' ? 5000 : 2000;
      if (stringVal.length > maxLen) {
        return { valid: false, error: `Field "${f.label}" exceeds maximum length of ${maxLen} characters.` };
      }

      // Specific type validations
      if (f.type === 'email') {
        if (!EMAIL_REGEX.test(stringVal.toLowerCase())) {
          return { valid: false, error: `Please enter a valid email address for "${f.label}".` };
        }
      } else if (f.type === 'url') {
        if (!URL_REGEX.test(stringVal)) {
          return { valid: false, error: `Please enter a valid URL for "${f.label}".` };
        }
      } else if (f.type === 'number') {
        const num = Number(stringVal);
        if (isNaN(num)) {
          return { valid: false, error: `Please enter a valid number for "${f.label}".` };
        }
        if (f.validation?.min !== undefined && num < f.validation.min) {
          return { valid: false, error: `"${f.label}" must be at least ${f.validation.min}.` };
        }
        if (f.validation?.max !== undefined && num > f.validation.max) {
          return { valid: false, error: `"${f.label}" cannot exceed ${f.validation.max}.` };
        }
      } else if ((f.type === 'dropdown' || f.type === 'select') || f.type === 'radio') {
        const cleanOpts = (f.options || []).map((o) => String(o).trim());
        if (cleanOpts.length > 0 && !cleanOpts.includes(stringVal)) {
          return { valid: false, error: `Invalid option selected for "${f.label}".` };
        }
      }

      sanitizedValues[f.name] = stringVal;
    }
  }

  return { valid: true, sanitizedValues };
}

/**
 * Maps raw submission dictionary to standardized Lead model attributes.
 */
export function mapSubmissionToLead(formDoc, rawData = {}) {
  const data = typeof rawData === 'object' && rawData !== null ? rawData : {};

  function findVal(...keys) {
    for (const k of keys) {
      const lower = k.toLowerCase();
      for (const [prop, val] of Object.entries(data)) {
        if (prop.toLowerCase() === lower && val !== undefined && val !== null && String(val).trim() !== '') {
          return String(val).trim();
        }
      }
    }
    return '';
  }

  const fields = Array.isArray(formDoc?.fields) ? formDoc.fields : [];
  let emailFieldVal = '';
  let phoneFieldVal = '';
  let companyFieldVal = '';
  let contactPersonVal = '';
  let notesVal = '';

  for (const f of fields) {
    const val = findVal(f.name, f.id, f.label);
    if (!val) continue;

    if (f.type === 'email' && !emailFieldVal) emailFieldVal = val;
    if ((f.type === 'phone' || f.type === 'tel') && !phoneFieldVal) phoneFieldVal = val;
    if (
      (f.name.includes('company') || f.name.includes('org') || f.label.toLowerCase().includes('company')) &&
      !companyFieldVal
    ) {
      companyFieldVal = val;
    }
    if (
      (f.name.includes('contact') || f.name.includes('person') || f.name.includes('name') || f.label.toLowerCase().includes('name')) && !f.name.includes('company') &&
      !contactPersonVal
    ) {
      contactPersonVal = val;
    }
    if (
      (f.type === 'textarea' || f.name.includes('note') || f.name.includes('inquiry') || f.name.includes('message')) &&
      !notesVal
    ) {
      notesVal = val;
    }
  }

  const companyName =
    companyFieldVal ||
    findVal('companyname', 'company_name', 'company', 'organization') ||
    contactPersonVal ||
    (formDoc?.name ? `Lead from ${formDoc.name}` : 'Website Lead');

  const contactPerson =
    contactPersonVal ||
    findVal('contactperson', 'contact_person', 'name', 'fullname', 'contact');

  const email =
    emailFieldVal ||
    findVal('email', 'workemail', 'work_email', 'emailaddress');

  const phone =
    phoneFieldVal ||
    findVal('phone', 'phonenumber', 'phone_number', 'telephone', 'mobile');

  const notes =
    notesVal ||
    findVal('notes', 'message', 'inquiry', 'details', 'comments', 'description');

  return {
    companyName: companyName.slice(0, 100),
    contactPerson: contactPerson.slice(0, 100),
    email: email ? email.toLowerCase() : undefined,
    phone: phone.slice(0, 30),
    notes: notes.slice(0, 1000),
    submissionData: data,
  };
}

/**
 * Synthesizes a clean JSON representation of custom fields for external/schema consumers.
 */
export function fieldsToSchema(title, fields = []) {
  return {
    display: 'form',
    title: title || 'Lead Form',
    components: fields.map((f) => ({
      key: f.name,
      label: f.label,
      type: f.type,
      input: true,
      placeholder: f.placeholder || '',
      validate: {
        required: Boolean(f.required),
        ...(f.validation || {}),
      },
      options: f.options || [],
    })),
  };
}
