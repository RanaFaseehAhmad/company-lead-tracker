import mongoose from 'mongoose';

const CompanySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a company name.'],
      unique: true,
      trim: true,
      maxlength: [120, 'Company name cannot exceed 120 characters.'],
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'approved', 'blocked'],
        message: '{VALUE} is not a valid company status.',
      },
      default: 'pending',
      index: true,
    },
    contactName: {
      type: String,
      trim: true,
      maxlength: [100, 'Contact name cannot exceed 100 characters.'],
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid contact email address.',
      ],
    },
    contactPhone: {
      type: String,
      trim: true,
      maxlength: [30, 'Contact phone cannot exceed 30 characters.'],
    },
    website: {
      type: String,
      trim: true,
      maxlength: [200, 'Company website cannot exceed 200 characters.'],
      default: '',
    },
    address: {
      type: String,
      trim: true,
      maxlength: [300, 'Business address cannot exceed 300 characters.'],
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

CompanySchema.index({ createdAt: -1 });

export default mongoose.models.Company || mongoose.model('Company', CompanySchema);
