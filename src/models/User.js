import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name.'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters.'],
    },
    email: {
      type: String,
      required: [true, 'Please provide an email address.'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address.',
      ],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required.'],
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: ['super_admin', 'company_admin'],
        message: '{VALUE} is not a valid user role.',
      },
      default: 'company_admin',
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'disabled'],
        message: '{VALUE} is not a valid status.',
      },
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.index({ email: 1 }, { unique: true });

export default mongoose.models.User || mongoose.model('User', UserSchema);
