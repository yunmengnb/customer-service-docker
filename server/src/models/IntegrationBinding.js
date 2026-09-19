const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const IntegrationBindingSchema = new Schema(
  {
    platformId: {
      type: String,
      required: true,
      default: 'jingpro',
      index: true,
    },
    connectionId: {
      type: Schema.Types.ObjectId,
      ref: 'TenantIntegration',
      required: true,
      index: true,
    },
    jingproUserId: {
      type: String,
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'TenantUser',
      required: true,
    },
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'Channel',
      required: true,
    },
    publicToken: {
      type: String,
      required: true,
      default: '',
    },
    link: {
      type: String,
      required: false,
      default: '',
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

IntegrationBindingSchema.index(
  { connectionId: 1, jingproUserId: 1 },
  { unique: true, name: 'idx_connection_jingpro_user' }
);
IntegrationBindingSchema.index(
  { ownerUserId: 1 },
  { unique: true, name: 'idx_integration_owner_user' }
);
IntegrationBindingSchema.index({ tenantId: 1 });
IntegrationBindingSchema.index({ channelId: 1 }, { unique: false, sparse: true });

IntegrationBindingSchema.set('toJSON', { getters: true, virtuals: false });

module.exports = mongoose.model('IntegrationBinding', IntegrationBindingSchema);
