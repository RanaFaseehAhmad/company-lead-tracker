import mongoose from 'mongoose';

const LeadSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    formId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Form',
      default: null,
      index: true,
    },
    formName: {
      type: String,
      trim: true,
      default: '',
    },
    source: {
      type: String,
      default: 'manual',
      index: true,
    },
    sourceUrl: {
      type: String,
      trim: true,
      default: '',
    },
    referrer: {
      type: String,
      trim: true,
      default: '',
    },
    submissionData: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    companyName: {
      type: String,
      required: [true, 'Please provide a company name.'],
      trim: true,
      maxlength: [100, 'Company name cannot exceed 100 characters.'],
    },
    contactPerson: {
      type: String,
      trim: true,
      maxlength: [100, 'Contact person cannot exceed 100 characters.'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address.',
      ],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [30, 'Phone number cannot exceed 30 characters.'],
    },
    status: {
      type: String,
      enum: {
        values: [
          'New',
          'Approved',
          'Contacted',
          'Qualified',
          'Proposal Sent',
          'Won',
          'Lost',
          'Converted',
          'Rejected',
          'new',
          'approved',
          'contacted',
          'qualified',
          'converted',
          'rejected',
          'lost',
          'pending',
          'New / Pending',
        ],
        message: '{VALUE} is not a valid lead status.',
      },
      default: 'New',
    },
    contactNote: {
      type: String,
      trim: true,
      maxlength: [1000, 'Contact note cannot exceed 1000 characters.'],
      default: '',
    },
    rejectionNote: {
      type: String,
      trim: true,
      maxlength: [1000, 'Rejection note cannot exceed 1000 characters.'],
      default: '',
    },
    dealValue: {
      type: Number,
      default: 0,
      min: [0, 'Deal value cannot be negative.'],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes cannot exceed 1000 characters.'],
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for high-performance multi-tenant retrieval and analytics
LeadSchema.index({ createdAt: -1 });
LeadSchema.index({ status: 1 });
LeadSchema.index({ companyId: 1, createdAt: -1 });
LeadSchema.index({ companyId: 1, formId: 1, createdAt: -1 });
LeadSchema.index({ formId: 1, createdAt: -1 });

// Ensure schema changes take immediate effect in Next.js development server
if (mongoose.models && mongoose.models.Lead) {
  delete mongoose.models.Lead;
}

export default mongoose.model('Lead', LeadSchema);
