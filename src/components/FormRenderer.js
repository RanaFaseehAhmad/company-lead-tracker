'use client';

import { useState } from 'react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\/[^\s]+$/;

export default function FormRenderer({
  fields = [],
  title = '',
  description = '',
  onSubmit = null,
  isSubmitting = false,
  submitButtonLabel = 'Submit',
  readOnly = false,
}) {
  const [formData, setFormData] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  // Sort fields by order
  const sortedFields = [...(fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  function handleChange(name, value) {
    if (readOnly) return;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  function validate() {
    const errors = {};

    for (const f of sortedFields) {
      const val = formData[f.name];
      const valStr = typeof val === 'string' ? val.trim() : val;

      // Required check
      if (f.required) {
        if (f.type === 'checkbox') {
          if (!val) {
            errors[f.name] = `${f.label} must be checked.`;
          }
        } else if (valStr === undefined || valStr === null || valStr === '') {
          errors[f.name] = `${f.label} is required.`;
        }
      }

      // Type-specific checks if value is non-empty
      if (valStr !== undefined && valStr !== null && valStr !== '') {
        const str = String(valStr).trim();

        if (f.type === 'email' && !EMAIL_REGEX.test(str)) {
          errors[f.name] = 'Please enter a valid email address.';
        }

        if (f.type === 'url' && !URL_REGEX.test(str)) {
          errors[f.name] = 'Please enter a valid URL starting with http:// or https://';
        }

        if (f.type === 'number') {
          const num = Number(str);
          if (isNaN(num)) {
            errors[f.name] = 'Please enter a valid number.';
          } else {
            if (f.validation?.min !== undefined && num < f.validation.min) {
              errors[f.name] = `Value cannot be less than ${f.validation.min}.`;
            }
            if (f.validation?.max !== undefined && num > f.validation.max) {
              errors[f.name] = `Value cannot exceed ${f.validation.max}.`;
            }
          }
        }

        if (f.validation?.minLength && str.length < f.validation.minLength) {
          errors[f.name] = `Minimum length is ${f.validation.minLength} characters.`;
        }

        if (f.validation?.maxLength && str.length > f.validation.maxLength) {
          errors[f.name] = `Maximum length is ${f.validation.maxLength} characters.`;
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    if (readOnly) return;
    if (!validate()) return;

    if (onSubmit) {
      try {
        await onSubmit(formData);
      } catch (err) {
        setFormError(err.message || 'Submission failed. Please try again.');
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Form Header */}
      {(title || description) && (
        <div className="border-b border-slate-100 pb-4 mb-2">
          {title && <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>}
          {description && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>}
        </div>
      )}

      {/* Form Error Banner */}
      {formError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
          <svg className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{formError}</span>
        </div>
      )}

      {/* Empty State */}
      {sortedFields.length === 0 && (
        <div className="text-center py-8 text-xs text-slate-400">
          This form does not contain any fields yet.
        </div>
      )}

      {/* Field List */}
      {sortedFields.map((field) => {
        const error = fieldErrors[field.name];
        const value = formData[field.name] !== undefined ? formData[field.name] : '';

        return (
          <div key={field.id || field.name} className="space-y-1.5">
            <label
              htmlFor={`field-${field.name}`}
              className="block text-xs font-semibold text-slate-700"
            >
              {field.label}
              {field.required && <span className="text-rose-500 ml-1" title="Required">*</span>}
            </label>

            {/* Input based on field.type */}
            {field.type === 'textarea' ? (
              <textarea
                id={`field-${field.name}`}
                name={field.name}
                rows={4}
                value={value}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={field.placeholder || ''}
                disabled={isSubmitting || readOnly}
                className={`w-full p-3 rounded-xl bg-white border text-xs text-slate-800 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 resize-y ${
                  error
                    ? 'border-rose-400 focus:ring-rose-500/20'
                    : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                }`}
              />
            ) : field.type === 'dropdown' ? (
              <select
                id={`field-${field.name}`}
                name={field.name}
                value={value}
                onChange={(e) => handleChange(field.name, e.target.value)}
                disabled={isSubmitting || readOnly}
                className={`w-full h-11 px-3.5 rounded-xl bg-white border text-xs text-slate-800 transition-colors focus:outline-none focus:ring-2 ${
                  error
                    ? 'border-rose-400 focus:ring-rose-500/20'
                    : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                }`}
              >
                <option value="">{field.placeholder || '-- Select an option --'}</option>
                {(field.options || []).map((opt, i) => (
                  <option key={i} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === 'radio' ? (
              <div className="space-y-2 pt-1">
                {(field.options || []).map((opt, i) => (
                  <label key={i} className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name={field.name}
                      value={opt}
                      checked={value === opt}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      disabled={isSubmitting || readOnly}
                      className="h-4 w-4 text-indigo-600 border-slate-300 focus:ring-indigo-500"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            ) : field.type === 'checkbox' ? (
              <div className="pt-1">
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    id={`field-${field.name}`}
                    type="checkbox"
                    name={field.name}
                    checked={Boolean(value)}
                    onChange={(e) => handleChange(field.name, e.target.checked)}
                    disabled={isSubmitting || readOnly}
                    className="h-4 w-4 mt-0.5 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>{field.placeholder || field.label}</span>
                </label>
              </div>
            ) : (
              <input
                id={`field-${field.name}`}
                type={
                  field.type === 'email'
                    ? 'email'
                    : field.type === 'phone'
                    ? 'tel'
                    : field.type === 'number'
                    ? 'number'
                    : field.type === 'date'
                    ? 'date'
                    : field.type === 'url'
                    ? 'url'
                    : field.type === 'password'
                    ? 'password'
                    : 'text'
                }
                name={field.name}
                value={value}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={field.placeholder || ''}
                disabled={isSubmitting || readOnly}
                className={`w-full h-11 px-3.5 rounded-xl bg-white border text-xs text-slate-800 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                  error
                    ? 'border-rose-400 focus:ring-rose-500/20'
                    : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                }`}
              />
            )}

            {/* Error Message */}
            {error && (
              <p className="text-[11px] text-rose-600 font-medium flex items-center gap-1 mt-1">
                <span>•</span> {error}
              </p>
            )}
          </div>
        );
      })}

      {/* Submit Button */}
      {!readOnly && sortedFields.length > 0 && (
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold text-xs transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          {isSubmitting ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Submitting...</span>
            </>
          ) : (
            <span>{submitButtonLabel}</span>
          )}
        </button>
      )}
    </form>
  );
}
