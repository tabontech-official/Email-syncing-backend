import dayjs from 'dayjs';
import {
  platformFromAddress,
  sendPlatformMail,
} from '../utils/platformMailer.js';
import { authModel } from '../Models/auth.js';
import { listingModel } from '../Models/Listing.js';
import { orderModel } from '../Models/order.js';
import { PayoutConfig } from '../Models/finance.js';
import cron from "node-cron"
/*
 * This file used to build its own Gmail transport from an address and app
 * password written directly into the source. It now sends as the
 * configured platform mailbox (master admin -> Platform Email).
 */
const sendEmail = async ({ to, subject, html }) => {
  try {
    await sendPlatformMail({ to, subject, html });
    console.log('📩 Email sent successfully to', to);
  } catch (err) {
    console.error('❌ Email send failed:', err.message);
  }
};

// export const financeCron = () => {
//   setInterval(async () => {
//     try {
//       console.log('🔁 Running payout cron job...');

//       const config = await PayoutConfig.findOne({});
//       if (!config) return console.error('❌ Payout config not found');

//       const today = dayjs().startOf('day');

//       const orders = await orderModel.find({
//         payoutStatus: 'pending',
//         scheduledPayoutDate: {
//           $gte: today.toDate(),
//           $lt: today.add(1, 'day').toDate(),
//         },
//       });

//       if (!orders.length) {
//         console.log('✅ No eligible orders for payout today');
//         return;
//       }

//       const userPayments = {};
//       const userCache = {};
//       const productCache = {};

//       for (const order of orders) {
//         for (const item of order.lineItems || []) {
//           const variantId = item.variant_id;
//           if (!variantId) continue;

//           if (!productCache[variantId]) {
//             productCache[variantId] = await listingModel.findOne({
//               'variants.id': variantId,
//             });
//           }

//           const product = productCache[variantId];
//           if (!product || !product.userId) continue;

//           const userId = product.userId.toString();
//           const amount = Number(item.price || 0) * Number(item.quantity || 1);

//           if (!userPayments[userId]) {
//             userPayments[userId] = { amount: 0, paypal: '', email: '' };
//           }

//           userPayments[userId].amount += amount;

//           if (!userCache[userId]) {
//             userCache[userId] = await authModel.findById(userId);
//           }

//           const user = userCache[userId];
//           if (user) {
//             userPayments[userId].paypal = user.paypalAccount || 'N/A';
//             userPayments[userId].email = user.email || 'N/A';
//           }
//         }

//         order.payoutStatus = 'Deposited';
//         await order.save();
//       }

//       let emailBody = `<h3>💸 Payout Summary for ${today.format('MMM D, YYYY')}</h3><ul>`;
//       Object.entries(userPayments).forEach(([uid, data]) => {
//         emailBody += `<li><strong>${data.email}</strong> → <strong>${data.paypal}</strong> — $${data.amount.toFixed(2)}</li>`;
//       });
//       emailBody += '</ul>';

//       await sendEmail({
//         to: 'aydimarketplace@gmail.com',
//         subject: `Payout Summary - ${today.format('MMM D, YYYY')}`,
//         html: emailBody,
//       });

//       console.log('✅ Payout email sent and orders updated.');
//     } catch (error) {
//       console.error('🔥 Payout cron failed:', error);
//     }
//   }, 1000); // Run every second
// };


export const financeCron = () => {
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('🔁 Running hourly payout cron...');

      const config = await PayoutConfig.findOne({});
      if (!config) return console.error('❌ Payout config not found');

      const today = dayjs().startOf('day');

      const orders = await orderModel.find({
        payoutStatus: 'pending',
        scheduledPayoutDate: {
          $gte: today.toDate(),
          $lt: today.add(1, 'day').toDate(),
        },
      });

      if (!orders.length) {
        console.log('✅ No eligible orders for payout today');
        return;
      }

      const userPayments = {};
      const userCache = {};
      const productCache = {};

      for (const order of orders) {
        for (const item of order.lineItems || []) {
          const variantId = item.variant_id;
          if (!variantId) continue;

          if (!productCache[variantId]) {
            productCache[variantId] = await listingModel.findOne({
              'variants.id': variantId,
            });
          }

          const product = productCache[variantId];
          if (!product || !product.userId) continue;

          const userId = product.userId.toString();
          const amount = Number(item.price || 0) * Number(item.quantity || 1);

          if (!userPayments[userId]) {
            userPayments[userId] = { amount: 0, paypal: '', email: '' };
          }

          userPayments[userId].amount += amount;

          if (!userCache[userId]) {
            userCache[userId] = await authModel.findById(userId);
          }

          const user = userCache[userId];
          if (user) {
            userPayments[userId].paypal = user.paypalAccount || 'N/A';
            userPayments[userId].email = user.email || 'N/A';
          }
        }

        order.payoutStatus = 'Deposited';
        await order.save();
      }

      let emailBody = `<h3>💸 Payout Summary for ${today.format('MMM D, YYYY')}</h3><ul>`;
      Object.entries(userPayments).forEach(([uid, data]) => {
        emailBody += `<li><strong>${data.email}</strong> → <strong>${data.paypal}</strong> — $${data.amount.toFixed(2)}</li>`;
      });
      emailBody += '</ul>';

      /*
       * Internal report. Addressed to the configured platform mailbox
       * rather than a literal that predates this project.
       */
      await sendEmail({
        to: await platformFromAddress(),
        subject: `Payout Summary - ${today.format('MMM D, YYYY')}`,
        html: emailBody,
      });

      console.log('✅ Payout email sent and orders updated.');
    } catch (error) {
      console.error('🔥 Payout cron failed:', error);
    }
  });
};