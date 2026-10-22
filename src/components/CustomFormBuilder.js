'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import FormRenderer from './FormRenderer';

const SUPPORTED_TYPES = [
  { value: 'text', label: 'Single-Line Text' },
  { value: 'email', label: 'Email Address' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Paragraph Text (Textarea)' },
  { value: 'dropdown', label: 'Dropdown Select' },
  { value: 'radio', label: 'Radio Buttons' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date Picker' },
  { value: 'url', label: 'Website URL' },
  { value: 'password', label: 'Password' },
];

function generateFieldId() {
  return `f_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function labelToKey(label, fallbackIndex = 0, existingKeys = new Set()) {
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

function createInitialField() {
  return {
    id: generateFieldId(),
    name: 'full_name',
    type: 'text',
    label: 'Full Name',
    placeholder: 'e.g. Jane Doe',
    required: true,
    options: [],
    validation: {},
    order: 0,
    isSaved: false,
  };
}

function serializeWorkingCopy(title, description, fields) {
  return JSON.stringify({
    title: (title || '').trim(),
    description: (description || '').trim(),
    fields: (fields || []).map((f, i) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      label: (f.label || '').trim(),
      placeholder: (f.placeholder || '').trim(),
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? f.options.map((o) => String(o).trim()).filter(Boolean) : [],
      order: i,
    })),
  });
}

export default function CustomFormBuilder({ initialFormId = null }) {
  const router = useRouter();
  const routeParams = useParams();

  const effectiveFormId = initialFormId || routeParams?.id || null;

  const [formId, setFormId] = useState(effectiveFormId);
  const [title, setTitle] = useState(effectiveFormId ? '' : 'New Lead Capture Form');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [publicId, setPublicId] = useState(null);
  const [submissionsCount, setSubmissionsCount] = useState(0);

  // For new forms: exactly one initial field. For existing forms: empty until loaded.
  const [fields, setFields] = useState(effectiveFormId ? [] : [createInitialField()]);

  // UI state
  const [isLoading, setIsLoading] = useState(Boolean(effectiveFormId));
  const [loadError, setLoadError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [previewFeedback, setPreviewFeedback] = useState(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [embedModalOpen, setEmbedModalOpen] = useState(false);
  const showEmbedModal = embedModalOpen;
  const setShowEmbedModal = setEmbedModalOpen;
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [selectedTypeToAdd, setSelectedTypeToAdd] = useState('text');
  const [newOptionInputs, setNewOptionInputs] = useState({});

  // Snapshot of loaded form to detect unsaved changes and support Discard
  const [initialSnapshot, setInitialSnapshot] = useState(
    effectiveFormId ? null : serializeWorkingCopy('New Lead Capture Form', '', [createInitialField()])
  );
  const loadedFormRef = useRef(null);

  // Sync formId if prop or route param changes
  // Load existing form data if editing
  useEffect(() => {
    if (!effectiveFormId) {
      return;
    }

    let isMounted = true;

    async function loadForm() {
      try {
        setIsLoading(true);
        setLoadError(null);
        setErrorMessage(null);

        const res = await fetch(`/api/forms/${effectiveFormId}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        const data = await res.json();

        if (!res.ok || !data.success || !data.data) {
          throw new Error(data.error || 'Failed to load form details. The form may not exist or belongs to another workspace.');
        }

        if (!isMounted) return;

        const f = data.data;
        setFormId(f._id || f.id);
        const loadedTitle = f.title || f.name || 'Untitled Form';
        const loadedDesc = f.description || '';
        const loadedStatus = f.status || 'draft';
        setTitle(loadedTitle);
        setDescription(loadedDesc);
        setStatus(loadedStatus);
        setPublicId(f.publicId);
        setSubmissionsCount(f.submissionsCount || 0);

        let parsedFields = [];
        if (Array.isArray(f.fields) && f.fields.length > 0) {
          const usedKeys = new Set();
          parsedFields = f.fields.map((fld, idx) => {
            const name = (fld.name || labelToKey(fld.label, idx, usedKeys)).toLowerCase();
            usedKeys.add(name);
            return {
              id: fld.id || generateFieldId(),
              name,
              type: fld.type || 'text',
              label: fld.label || 'Field',
              placeholder: fld.placeholder || '',
              required: Boolean(fld.required),
              options: Array.isArray(fld.options) ? fld.options : [],
              validation: fld.validation || {},
              order: fld.order !== undefined ? fld.order : idx,
              isSaved: true,
            };
          });
        } else {
          parsedFields = [createInitialField()];
        }

        setFields(parsedFields);
        const snapshot = serializeWorkingCopy(loadedTitle, loadedDesc, parsedFields);
        setInitialSnapshot(snapshot);
        loadedFormRef.current = {
          title: loadedTitle,
          description: loadedDesc,
          fields: parsedFields,
          status: loadedStatus,
          publicId: f.publicId,
        };
      } catch (err) {
        if (isMounted) setLoadError(err.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadForm();

    return () => {
      isMounted = false;
    };
  }, [effectiveFormId]);

  // Detect unsaved changes (dirty state)
  const currentSnapshot = serializeWorkingCopy(title, description, fields);
  const isDirty = initialSnapshot !== null && initialSnapshot !== currentSnapshot;

  // Discard changes and revert to loaded snapshot
  function handleDiscardChanges() {
    if (!initialSnapshot) return;
    try {
      const parsed = JSON.parse(initialSnapshot);
      setTitle(parsed.title || '');
      setDescription(parsed.description || '');
      if (loadedFormRef.current?.fields) {
        setFields(loadedFormRef.current.fields.map((f) => ({ ...f, isSaved: true })));
      } else if (!effectiveFormId) {
        setFields([createInitialField()]);
      }
      setErrorMessage(null);
      setSuccessMessage('Unsaved changes discarded.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch {
      // no-op
    }
  }

  // Field manipulation helpers
  function addField(typeOrEvent = 'text') {
    const type = typeof typeOrEvent === 'string' && typeOrEvent ? typeOrEvent : 'text';
    const newIdx = fields.length;
    const defaultLabels = {
      text: 'Single-Line Text',
      email: 'Work Email Address',
      phone: 'Phone Number',
      number: 'Quantity / Number',
      textarea: 'Comments / Inquiries',
      dropdown: 'Select Option',
      radio: 'Choose One',
      checkbox: 'Terms Agreement',
      date: 'Preferred Date',
      url: 'Website Link',
      password: 'Password',
    };

    const label = defaultLabels[type] || 'New Field';
    const existingKeys = new Set(fields.map((f) => f.name));
    const autoKey = labelToKey(label, newIdx, existingKeys);

    const newField = {
      id: generateFieldId(),
      name: autoKey,
      type,
      label,
      placeholder: type === 'dropdown' ? 'Select an option' : '',
      required: false,
      options: type === 'dropdown' || type === 'radio' ? ['Option 1', 'Option 2'] : [],
      validation: {},
      order: newIdx,
      isSaved: false,
    };

    setFields((prev) => [...prev, newField]);
  }

  function removeField(indexOrId) {
    if (fields.length <= 1) return;
    setFields((prev) => {
      let remaining;
      if (typeof indexOrId === 'number') {
        remaining = prev.filter((_, idx) => idx !== indexOrId);
      } else {
        remaining = prev.filter((f) => f && f.id !== indexOrId);
      }
      return remaining.map((f, i) => ({ ...f, order: i }));
    });
  }

  function moveField(index, direction) {
    const delta = direction === 'up' || direction === -1 ? -1 : direction === 'down' || direction === 1 ? 1 : 0;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    setFields((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy.map((f, i) => ({ ...f, order: i }));
    });
  }

  function updateField(indexOrId, keyOrUpdates, value) {
    setFields((prev) =>
      prev.map((f, idx) => {
        const matches = typeof indexOrId === 'number' ? idx === indexOrId : f && f.id === indexOrId;
        if (!matches) return f;
        if (typeof keyOrUpdates === 'object' && keyOrUpdates !== null) {
          return { ...f, ...keyOrUpdates };
        }
        return { ...f, [keyOrUpdates]: value };
      })
    );
  }

  // Auto-generate key on label blur only for newly created (unsaved) fields
  function handleLabelBlur(indexOrId, currentLabel) {
    setFields((prev) => {
      const field = typeof indexOrId === 'number' ? prev[indexOrId] : prev.find((f) => f && f.id === indexOrId);
      if (!field || field.isSaved) return prev;

      const otherKeys = new Set(
        prev
          .filter((f, idx) => (typeof indexOrId === 'number' ? idx !== indexOrId : f && f.id !== indexOrId))
          .map((f) => f.name)
      );
      const newKey = labelToKey(currentLabel, field.order || 0, otherKeys);

      return prev.map((f, idx) => {
        const matches = typeof indexOrId === 'number' ? idx === indexOrId : f && f.id === indexOrId;
        return matches ? { ...f, name: newKey } : f;
      });
    });
  }

  function addOption(fieldId, optionText) {
    if (!optionText || !optionText.trim()) return;
    setFields((prev) =>
      prev.map((f) => {
        if (!f || f.id !== fieldId) return f;
        const opts = Array.isArray(f.options) ? [...f.options] : [];
        opts.push(optionText.trim());
        return { ...f, options: opts };
      })
    );
    setNewOptionInputs((prev) => ({ ...prev, [fieldId]: '' }));
  }

  function removeOption(fieldId, optionIndex) {
    setFields((prev) =>
      prev.map((f) => {
        if (!f || f.id !== fieldId) return f;
        const opts = (f.options || []).filter((_, idx) => idx !== optionIndex);
        return { ...f, options: opts };
      })
    );
  }

  // Save / Update / Publish handler
  async function handleSave(targetStatus = status) {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!title.trim()) {
      setErrorMessage('Form title is required.');
      return;
    }

    if (fields.length === 0) {
      setErrorMessage('A form must contain at least one field.');
      return;
    }

    // Ensure stable unique submission keys
    const usedKeys = new Set();
    const sanitizedFields = fields.filter(Boolean).map((f, idx) => {
      let name = (f.name || labelToKey(f.label, idx, usedKeys)).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (!name) name = `field_${idx + 1}`;

      let uniqueName = name;
      let counter = 2;
      while (usedKeys.has(uniqueName)) {
        uniqueName = `${name}_${counter}`;
        counter++;
      }
      usedKeys.add(uniqueName);

      return {
        id: f.id,
        type: f.type,
        label: f.label || `Field ${idx + 1}`,
        name: uniqueName,
        required: Boolean(f.required),
        placeholder: f.placeholder || '',
        options: Array.isArray(f.options) ? f.options : [],
        validation: f.validation || {},
        order: idx,
      };
    });

    setIsSaving(true);

    try {
      const payload = {
        name: title.trim(),
        title: title.trim(),
        description: description.trim(),
        status: targetStatus,
        fields: sanitizedFields,
      };

      const targetId = formId || effectiveFormId;
      const isEdit = Boolean(targetId);
      const url = isEdit ? `/api/forms/${targetId}` : '/api/forms';
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to save form.');
      }

      const saved = result.data || result.form;
      setStatus(saved.status || targetStatus);
      setPublicId(saved.publicId || publicId);

      // Mark all current fields as saved so their keys remain stable on future edits
      const updatedSavedFields = sanitizedFields.map((f) => ({ ...f, isSaved: true }));
      setFields(updatedSavedFields);

      // Update snapshot to reset isDirty
      const updatedSnapshot = serializeWorkingCopy(title, description, updatedSavedFields);
      setInitialSnapshot(updatedSnapshot);
      loadedFormRef.current = {
        title: title.trim(),
        description: description.trim(),
        fields: updatedSavedFields,
        status: saved.status || targetStatus,
        publicId: saved.publicId || publicId,
      };

      if (!isEdit) {
        setFormId(saved._id);
        router.replace('/dashboard/company-admin/forms');
      }

      // Context-aware success message
      let msg = 'Form changes saved successfully.';
      if (!isEdit && targetStatus === 'published') {
        msg = 'Form published successfully! It is now live and capturing leads.';
      } else if (!isEdit && targetStatus === 'draft') {
        msg = 'Form draft created successfully.';
      } else if (isEdit && targetStatus === 'published' && status === 'draft') {
        msg = 'Form published successfully! It is now live and capturing leads.';
      } else if (isEdit && targetStatus === 'published') {
        msg = 'Form updated successfully! Live form and embeds reflect your latest changes.';
      } else if (isEdit && targetStatus === 'draft' && status === 'published') {
        msg = 'Form has been unpublished and reverted to draft.';
      }

      setSuccessMessage(msg);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setErrorMessage(err.message || 'Error saving form.');
    } finally {
      setIsSaving(false);
    }
  }

  // Deliberate Unpublish handler
  async function handleUnpublish() {
    if (
      !window.confirm(
        'Are you sure you want to unpublish this form? Visitors will no longer be able to submit leads through the public URL or embeds until you publish it again.'
      )
    ) {
      return;
    }
    await handleSave('draft');
  }

  const embedOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const embedUrl = publicId ? `${embedOrigin}/embed/${publicId}` : '';
  const embedCodeSnippet = publicId
    ? `<iframe src="${embedUrl}" width="100%" height="600" frameborder="0" style="border:0;width:100%;height:600px;border-radius:12px;"></iframe>`
    : '';
  const embedSnippet = embedCodeSnippet;
  const publicUrl = embedUrl;

  // Loading state view
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[380px] bg-white border border-slate-200/80 rounded-2xl p-8 shadow-xs">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        <p className="text-xs text-slate-500 mt-3 font-semibold">Loading form configuration...</p>
      </div>
    );
  }

  // Load error view
  if (loadError) {
    return (
      <div className="bg-white border border-rose-200 rounded-2xl p-8 max-w-lg mx-auto text-center space-y-4 shadow-xs my-8">
        <div className="h-12 w-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto font-bold text-lg">
          !
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900">Unable to Load Form</h3>
          <p className="text-xs text-slate-600 mt-1">{loadError}</p>
        </div>
        <div className="flex items-center justify-center gap-2 pt-2">
          <Link
            href="/dashboard/company-admin/forms"
            className="h-8.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center"
          >
            Back to Forms
          </Link>
          <button
            onClick={() => {
              setLoadError(null);
              setIsLoading(true);
              setFormId(effectiveFormId);
            }}
            className="h-8.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center cursor-pointer shadow-xs"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const isPublishedForm = status === 'published';
  const isDraftForm = status === 'draft';
  const isExistingForm = Boolean(formId || effectiveFormId);

  return (
    <div className="w-full space-y-5">
      {/* Full-Width Builder Header */}
      <header className="w-full bg-white border border-slate-200/80 rounded-2xl p-4 sm:px-6 sm:py-3.5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Link
            href="/dashboard/company-admin/forms"
            className="h-9 w-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors shrink-0"
            title="Back to Forms"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {isExistingForm ? 'Edit Form' : 'New Form'}
              </span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                  isPublishedForm
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                    : 'bg-amber-50 text-amber-700 border border-amber-200/80'
                }`}
              >
                {status}
              </span>
              {isDirty && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                  Unsaved Changes
                </span>
              )}
              {submissionsCount > 0 && (
                <span className="text-[10px] text-slate-400">
                  � {submissionsCount} submission{submissionsCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Form Title..."
              className="text-base sm:text-lg font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none transition-colors px-0 py-0.5 w-full sm:w-80 truncate"
            />
          </div>
        </div>

        {/* Action Buttons: Status-Aware */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap">
          {/* Live Preview Button */}
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('live-form-preview');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
              setPreviewModalOpen(true);
            }}
            className="h-8.5 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span>Preview</span>
          </button>

          {/* Embed Code action (available whenever form has publicId) */}
          {publicId && (
            <button
              type="button"
              onClick={() => setEmbedModalOpen(true)}
              className="h-8.5 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <span>Embed Code</span>
            </button>
          )}

          {/* Discard Changes (for existing forms with unsaved edits) */}
          {isExistingForm && isDirty && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleDiscardChanges}
              className="h-8.5 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 hover:text-rose-600 transition-colors cursor-pointer"
              title="Discard all unsaved edits and restore last saved version"
            >
              Discard Changes
            </button>
          )}

          {/* CASE A: New Form */}
          {!isExistingForm && (
            <>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleSave('draft')}
                className="h-8.5 px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span>Save Draft</span>
              </button>

              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleSave('published')}
                className="h-8.5 px-3.5 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-all shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSaving ? (
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <span>Publish Form</span>
                )}
              </button>
            </>
          )}

          {/* CASE B: Existing Draft Form */}
          {isExistingForm && isDraftForm && (
            <>
              <button
                type="button"
                disabled={isSaving || !isDirty}
                onClick={() => handleSave('draft')}
                className="h-8.5 px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title={!isDirty ? 'No changes to save' : 'Save draft changes'}
              >
                {isSaving ? (
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-700 border-t-transparent" />
                ) : (
                  <span>Save Changes</span>
                )}
              </button>

              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleSave('published')}
                className="h-8.5 px-3.5 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-all shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <span>Publish Form</span>
              </button>
            </>
          )}

          {/* CASE C: Existing Published Form */}
          {isExistingForm && isPublishedForm && (
            <>
              {/* Separate deliberate Unpublish action */}
              <button
                type="button"
                disabled={isSaving}
                onClick={handleUnpublish}
                className="h-8.5 px-3 rounded-xl border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                title="Unpublish this form so it stops accepting public submissions"
              >
                <span>Unpublish</span>
              </button>

              {/* Primary Action: Update Form */}
              <button
                type="button"
                disabled={isSaving || !isDirty}
                onClick={() => handleSave('published')}
                className="h-8.5 px-4 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                title={!isDirty ? 'No changes to update' : 'Save changes to published form'}
              >
                {isSaving ? (
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <span>Update Form</span>
                )}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Alert Banners */}
      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2.5">
          <svg className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2.5">
          <svg className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Main Workspace: Two-Column Form Builder & Live Preview */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:kx-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Form Settings & Field Editor */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Form Details Card */}
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Form Settings
              </h2>
              
              <div>
                <label htmlFor="form-title-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Form Title <span className="text-rose-500">*</span>
                </label>
                <input
                  id="form-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Contact Us, Request a Quote"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="form-desc-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Description / Subtitle <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  id="form-desc-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short message to display at the top of your form..."
                  rows={2}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-700"
                />
              </div>
            </div>

            {/* Form Fields Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                    <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                    Form Fields ({fields.length})
                  </h2>
                  <p className="text-xs text-slate-500">Configure questions and input fields for your leads.</p>
                </div>
                <button
                  type="button"
                  id="btn-add-field-top"
                  onClick={addField}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/60 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Field
                </button>
              </div>

              {/* Field Cards */}
              <div className="space-y-3.5">
                {fields.map((field, index) => {
                  const isSelectOrRadio = field.type === 'dropdown' || field.type === 'select' || field.type === 'radio';
                  return (
                    <div
                      key={field.id || index}
                      id={'field-card-' + index}
                      className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-4 transition-all hover:border-slate-300 group"
                    >
                      {/* Card Header */}
                      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center">
                            {index + 1}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100/60 uppercase tracking-wider">
                            {field.type}
                          </span>
                          <span className="text-xs font-medium text-slate-700 truncate max-w-[200px]">
                            {field.label || 'Untitled Field'}
                          </span>
                          {field.required && (
                            <span className="text-xs font-semibold text-rose-500">*</span>
                          )}
                        </div>

                        {/* Order & Remove Controls */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            id={'btn-move-up-' + index}
                            onClick={() => moveField(index, 'up')}
                            disabled={index === 0}
                            title="Move Up"
                            className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-slate-100 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            id={'btn-move-down-' + index}
                            onClick={() => moveField(index, 'down')}
                            disabled={index === fields.length - 1}
                            title="Move Down"
                            className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-slate-100 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            id={'btn-remove-field-' + index}
                            onClick={() => removeField(index)}
                            disabled={fields.length <= 1}
                            title={fields.length <= 1 ? 'Forms must have at least one field' : 'Remove Field'}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-rose-50 transition-colors ml-1"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
{/* Card Content Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        {/* Field Label */}
                        <div>
                          <label htmlFor={'field-label-' + index} className="block text-xs font-medium text-slate-700 mb-1">
                            Field Label <span className="text-rose-500">*</span>
                          </label>
                          <input
                            id={'field-label-' + index}
                            type="text"
                            value={field.label}
                            onChange={(e) => updateField(index, { label: e.target.value })}
                            onBlur={(e) => handleLabelBlur(index, e.target.value)}
                            placeholder="e.g. Full Name"
                            className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-medium text-slate-800"
                          />
                        </div>

                        {/* Field Type */}
                        <div>
                          <label htmlFor={'field-type-' + index} className="block text-xs font-medium text-slate-700 mb-1">
                            Field Type
                          </label>
                          <select
                            id={'field-type-' + index}
                            value={field.type}
                            onChange={(e) => {
                              const newType = e.target.value;
                              const updates = { type: newType };
                              if ((newType === 'dropdown' || newType === 'select' || newType === 'radio') && (!field.options || field.options.length === 0)) {
                                updates.options = ['Option 1', 'Option 2'];
                              }
                              updateField(index, updates);
                            }}
                            className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800"
                          >
                            {SUPPORTED_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Placeholder (if applicable) */}
                        {!isSelectOrRadio && (
                          <div className="sm:col-span-2">
                            <label htmlFor={'field-placeholder-' + index} className="block text-xs font-medium text-slate-700 mb-1">
                              Placeholder Text <span className="text-slate-400 font-normal">(Optional)</span>
                            </label>
                            <input
                              id={'field-placeholder-' + index}
                              type="text"
                              value={field.placeholder || ''}
                              onChange={(e) => updateField(index, { placeholder: e.target.value })}
                              placeholder="e.g. Enter your full name..."
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-700"
                            />
                          </div>
                        )}

                        {/* Options Editor (for select and radio) */}
                        {isSelectOrRadio && (
                          <div className="sm:col-span-2 bg-slate-50 rounded-lg p-3 border border-slate-200/80">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-semibold text-slate-700">
                                Options ({field.options ? field.options.length : 0})
                              </label>
                              <button
                                type="button"
                                id={'btn-add-option-' + index}
                                onClick={() => {
                                  const current = field.options || [];
                                  const newOptions = [...(field.options || []), 'Option ' + (current.length + 1)];
                                  updateField(index, { options: newOptions });
                                }}
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                                </svg>
                                Add Option
                              </button>
                            </div>
                            <div className="space-y-1.5">
                              {(field.options || []).map((opt, optIdx) => (
                                <div key={optIdx} className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-slate-400 font-medium w-4 text-center">
                                    {optIdx + 1}.
                                  </span>
                                  <input
                                    type="text"
                                    id={'field-' + index + '-opt-' + optIdx}
                                    value={opt}
                                    onChange={(e) => {
                                      const nextOptions = [...(field.options || [])];
                                      nextOptions[optIdx] = e.target.value;
                                      updateField(index, { options: nextOptions });
                                    }}
                                    className="flex-1 px-2.5 py-1 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800"
                                  />
                                  <button
                                    type="button"
                                    id={'btn-remove-opt-' + index + '-' + optIdx}
                                    onClick={() => {
                                      const nextOptions = (field.options || []).filter((_, i) => i !== optIdx);
                                      updateField(index, { options: nextOptions });
                                    }}
                                    disabled={(field.options || []).length <= 1}
                                    title="Delete option"
                                    className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                             ))}
                            </div>
                          </div>
                        )}

                        {/* Required Checkbox */}
                        <div className="sm:col-span-2 pt-1 flex items-center justify-between border-t border-slate-100">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              id={'field-required-' + index}
                              type="checkbox"
                              checked={!!field.required}
                              onChange={(e) => updateField(index, { required: e.target.checked })}
                              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500/20"
                            />
                            <span className="text-xs font-medium text-slate-700">Required field</span>
                          </label>

                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add Field Bottom Button */}
              <button
                type="button"
                id="btn-add-field-bottom"
                onClick={addField}
                className="w-full py-3 border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-xl bg-slate-50/50 hover:bg-indigo-50/40 text-slate-600 hover:text-indigo-600 text-xs font-semibold flex items-center justify-center gap-2 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                Add Another Field
              </button>
            </div>
          </div>
          {/* Right Column: Sticky Live Form Preview */}
          <div className="lg:col-span-5" id="live-form-preview">
            <div className="sticky top-24 space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Live Form Preview
                </span>
                <span className="text-xs text-slate-400">Updates as you edit</span>
              </div>

              {/* Form Canvas Preview Container */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-gradient-to-br from-white to-slate-50/80">
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                    {title || 'Untitled Form'}
                  </h3>
                  {description && (
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      {description}
                    </p>
                  )}
                </div>

                {/* Simulated Form Fields Preview */}
                <div className="p-6 space-y-4">
                  {fields.map((field, idx) => (
                    <div key={field.id || idx} className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-800">
                        {field.label || 'Field ' + (idx + 1)}
                        {field.required && <span className="text-rose-500 ml-1">*</span>}
                      </label>

                      {field.type === 'textarea' ? (
                        <textarea
                          readOnly
                          rows={2}
                          placeholder={field.placeholder || ''}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-400 cursor-not-allowed resize-none"
                        />
                      ) : (field.type === 'dropdown' || field.type === 'select') ? (
                        <select
                          disabled
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-400 cursor-not-allowed"
                        >
                          <option value="">{field.placeholder || 'Select an option...'}</option>
                          {(field.options || []).map((opt, oIdx) => (
                            <option key={oIdx} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : field.type === 'radio' ? (
                        <div className="space-y-1.5 pt-1">
                          {(field.options || []).map((opt, oIdx) => (
                            <label key={oIdx} className="flex items-center gap-2 text-xs text-slate-600 cursor-not-allowed">
                              <input
                                type="radio"
                                disabled
                                name={'preview-radio-' + idx}
                                className="w-3.5 h-3.5 text-indigo-600 border-slate-300"
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                      ) : field.type === 'checkbox' ? (
                        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-not-allowed pt-1">
                          <input
                            type="checkbox"
                            disabled
                            className="w-3.5 h-3.5 rounded text-indigo-600 border-slate-300"
                          />
                          <span>{field.placeholder || field.label || 'Checkbox option'}</span>
                        </label>
                      ) : (
                        <input
                          type={
                            field.type === 'email' ? 'email' :
                            field.type === 'phone' || field.type === 'tel' ? 'tel' :
                            field.type === 'number' ? 'number' :
                            field.type === 'date' ? 'date' :
                            field.type === 'url' ? 'url' :
                            field.type === 'password' ? 'password' : 'text'
                          }
                          readOnly
                          placeholder={field.placeholder || ''}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-400 cursor-not-allowed"
                        />
                      )}
                    </div>
                  ))}

                  <div className="pt-2">
                    <button
                      type="button"
                      disabled
                      className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium text-xs shadow-sm opacity-90 cursor-not-allowed"
                    >
                      Submit Form
                    </button>
                    <p className="text-[10px] text-center text-slate-400 mt-2">
                      Live preview is interactive-only during visitor submission.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Embed Code Modal */}
      {showEmbedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4-4-4 4M6 16l-4-4 4-4" />
                </svg>
                Embed Form on Your Website
              </h3>
              <button
                type="button"
                id="btn-close-embed-modal"
                onClick={() => setShowEmbedModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Paste this responsive iframe code directly into your website. Updates published here automatically reflect through this code.
            </p>

            {/* Iframe Code Box */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">HTML Iframe Embed Code</label>
              <div className="relative">
                <textarea
                  readOnly
                  rows={3}
                  value={embedSnippet}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-900 text-slate-100 rounded-lg focus:outline-none"
                />
                <button
                  type="button"
                  id="btn-copy-embed-code"
                  onClick={() => {
                    navigator.clipboard.writeText(embedSnippet);
                    setSuccessMessage('Embed code copied to clipboard!');
                    setTimeout(() => setSuccessMessage(''), 3000);
                  }}
                  className="absolute top-2 right-2 px-2.5 py-1 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
                >
                  Copy
                </button>
              </div>
            </div>

            {/* Direct Form Link */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Direct Form Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={publicUrl}
                  className="flex-1 px-3 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                />
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  Open
                </a>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowEmbedModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
