// import cron from 'node-cron';
// import { listingModel } from '../Models/Listing.js';
// import { PromoModel } from '../Models/Promotions.js';

// export const productSubscriptionExpiration = () => {
//   cron.schedule('* * * * *', async () => {
//     try {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0);

//       const promotionsToUpdate = await PromoModel.find({
//         startDate: { $lte: today },
//       });

//       if (promotionsToUpdate.length > 0) {
//         const promoUpdateResult = await PromoModel.updateMany(
//           { startDate: { $lte: today } },
//           { $set: { status: 'inactive' } }
//         );

//         for (const promo of promotionsToUpdate) {
//           await listingModel.updateOne(
//             { 'variants.sku': promo.productSku },
//             { $set: { promotionStatus: 'inactive' } }
//           );
//         }

//         console.log(
//           `${promoUpdateResult.modifiedCount} promotions and listings activated.`
//         );
//       } else {
//         console.log('No promotions to activate today.');
//       }
//     } catch (error) {
//       console.error('Error in cron job:', error);
//     }
//   });
// };
import cron from 'node-cron';
import { authModel } from '../Models/auth.js';


export const productSubscriptionExpiration = () => {
 cron.schedule("0 */6 * * *", async () => {
  console.log("⏰ Renewing Gmail watches...");
  const users = await authModel.find();

  for (let user of users) {
    if (user.tokens) {
      await startWatch(user.tokens);
    }
  }
});
};
