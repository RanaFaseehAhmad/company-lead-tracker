/**
 * Dedicated Safe Super Admin Password Reset Script
 *
 * Usage:
 *   node scripts/reset-super-admin-password.js
 * Or with custom options:
 *   node scripts/reset-super-admin-password.js --email="admin@example.com" --password="NewSecurePassword"
 *
 * Defaults to SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD from .env.local
 * Never logs plain-text passwords or password hashes.
 */

import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dns from 'node:dns';

// 1. Parse .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// 2. DNS fallback for MongoDB Atlas SRV resolution
try {
  const customResolver = new dns.promises.Resolver();
  customResolver.setServers(['8.8.8.8', '1.1.1.1']);

  const originalResolve = dns.promises.resolve.bind(dns.promises);
  dns.promises.resolve = async function (hostname, rrtype) {
    if (rrtype === 'SRV' || rrtype === 'TXT') {
      try {
        return await customResolver.resolve(hostname, rrtype);
      } catch {
        return await originalResolve(hostname, rrtype);
      }
    }
    return await originalResolve(hostname, rrtype);
  };
} catch {
  // Graceful fallback
}

// 3. Parse CLI args
const args = process.argv.slice(2);
const cliArgs = {};
for (const arg of args) {
  if (arg.startsWith('--')) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const key = arg.slice(2, eqIdx).trim();
      const val = arg.slice(eqIdx + 1).trim();
      if (key && val) {
        cliArgs[key] = val;
      }
    }
  }
}

const email = cliArgs.email || process.env.SUPER_ADMIN_EMAIL;
const password = cliArgs.password || process.env.SUPER_ADMIN_PASSWORD;

async function resetPassword() {
  console.log('--- Super Admin Password Reset Tool ---');

  if (!email || !password) {
    console.error(
      'Error: Super Admin credentials missing.\n' +
      'Please supply credentials via .env.local (SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)\n' +
      'or pass command-line arguments: --email="admin@example.com" --password="NewPassword"'
    );
    process.exit(1);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    console.error('Error: Invalid email format.');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Error: Super Admin password must be at least 8 characters long.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Error: MONGODB_URI is not set in environment or .env.local.');
    process.exit(1);
  }

  try {
    console.log('Connecting to database...');
    await mongoose.connect(mongoUri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`Connected to MongoDB successfully (database: ${mongoose.connection.name}).`);

    const User =
      mongoose.models.User ||
      mongoose.model(
        'User',
        new mongoose.Schema(
          {
            name: { type: String, required: true },
            email: { type: String, required: true, unique: true },
            passwordHash: { type: String, required: true, select: true },
            role: { type: String, required: true },
            companyId: { type: mongoose.Schema.Types.ObjectId, default: null },
            status: { type: String, default: 'active' },
          },
          { timestamps: true }
        )
      );

    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
    if (!user) {
      console.error(`Error: User with email [${normalizedEmail}] does not exist in the database.`);
      await mongoose.disconnect();
      process.exit(1);
    }

    if (user.role !== 'super_admin') {
      console.error(
        `Error: User [${normalizedEmail}] has role [${user.role}]. This reset tool only modifies Super Admin accounts.`
      );
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log('Generating secure bcrypt hash...');
    const newHash = await bcrypt.hash(password, 10);

    user.passwordHash = newHash;
    user.status = 'active'; // ensure account is active
    await user.save();

    console.log(`SUCCESS: Password for Super Admin [${normalizedEmail}] has been reset successfully.`);
    console.log('Role: super_admin | Status: active');
  } catch (error) {
    console.error('Password reset failed with error:', error.message || error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

resetPassword();
