import mongoose from 'mongoose';

const emailSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Link email to user
    subject: { type: String },
    from: { type: String },
    to: { type: [String] }, // Multiple 'to' email addresses
    bcc: { type: [String] }, // Multiple 'bcc' email addresses
    cc: { type: [String] }, // Multiple 'cc' email addresses
    body: { type: String },
    snippet: { type: String },
    dateReceived: { type: Date },
    threadId: { type: String },
    messageId: { type: String }, // Store messageId for future reference
}, { timestamps: true });

export const EmailModel = mongoose.model('Email', emailSchema);
