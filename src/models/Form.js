import mongoose from 'mongoose';

export const ALLOWED_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'number',
  'textarea',
  'dropdown',
  'select',
  'tel',
  'radio',
  'checkbox',
  'date',
  'url',
  'password',
];

const FormFieldSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: [true, 'Field id is required.'],
      trim: true,
      maxlength: [60, 'Field id cannot exceed 60 characters.'],
    },
    type: {
      type: String,
      required: [true, 'Field type is required.'],
      enum: {
        values: ALLOWED_FIELD_TYPES,
        message: '{VALUE} is not a supported field type.',
      },
    },
    label: {
      type: String,
      required: [true, 'Field label is required.'],
      trim: true,
      maxlength: [120, 'Field label cannot exceed 120 characters.'],
    },
    name: {
      type: String,
      required: [true, 'Field submission key (name) is required.'],
      trim: true,
      lowercase: true,
      maxlength: [60, 'Field submission key cannot exceed 60 characters.'],
    },
    required: {
      type: Boolean,
      default: false,
    },
    placeholder: {
      type: String,
      trim: true,
      maxlength: [150, 'Placeholder cannot exceed 150 characters.'],
      default: '',
    },
    options: {
      type: [String],
      default: undefined,
    },
    validation: {
      minLength: { type: Number, default: undefined },
      maxLength: { type: Number, default: undefined },
      min: { type: Number, default: undefined },
      max: { type: Number, default: undefined },
      pattern: { type: String, default: undefined },
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const FormSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a form name.'],
      trim: true,
      maxlength: [120, 'Form name cannot exceed 120 characters.'],
    },
    title: {
      type: String,
      trim: true,
      maxlength: [120, 'Form title cannot exceed 120 characters.'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters.'],
      default: '',
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'Form must be associated with a company.'],
      index: true,
    },
    fields: {
      type: [FormFieldSchema],
      default: [],
    },
    status: {
      type: String,
      enum: {
        values: ['draft', 'published', 'archived'],
        message: '{VALUE} is not a valid form status.',
      },
      default: 'draft',
      index: true,
    },
    publicId: {
      type: String,
      required: [true, 'Public identifier is required.'],
      unique: true,
      index: true,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Optional legacy schema for non-breaking API compatibility
    formioSchema: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    formioFormId: {
      type: String,
      trim: true,
      default: null,
    },
    formioProject: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

FormSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret.__v;
    return ret;
  },
});

if (mongoose.models && mongoose.models.Form) {
  delete mongoose.models.Form;
}

export default mongoose.model('Form', FormSchema);
