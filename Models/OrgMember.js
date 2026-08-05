import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema(
  {
    view: { type: Boolean, default: true },
    edit: { type: Boolean, default: true },
    delete: { type: Boolean, default: false },
  },
  { _id: false }
);

const orgMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['Owner', 'Member'],
      default: 'Member',
    },
    team: {
      type: String,
      default: 'My Team',
    },
    status: {
      type: String,
      enum: ['Pending', 'Accepted', 'Active'],
      default: 'Pending',
    },
    invitationToken: {
      type: String,
      default: '',
    },
    permissions: {
      templates: { type: permissionSchema, default: () => ({ view: true, edit: true, delete: false }) },
      connections: { type: permissionSchema, default: () => ({ view: true, edit: true, delete: false }) },
      scenarios: { type: permissionSchema, default: () => ({ view: true, edit: true, delete: false }) },
      inbox: { type: permissionSchema, default: () => ({ view: true, edit: true, delete: false }) },
      organization: { type: permissionSchema, default: () => ({ view: true, edit: false, delete: false }) },
    },
  },
  { timestamps: true }
);

export const OrgMemberModel = mongoose.model('OrgMember', orgMemberSchema);
