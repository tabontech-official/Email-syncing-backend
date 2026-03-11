import { SalesLead } from "../Models/salesLead.js";

export const talkToSales = async (req, res) => {
  try {
    const { fullName, email, companyName, companySize, projectGoals } =
      req.body;

    if (!fullName || !email) {
      return res.status(400).json({
        error: 'Full name and email are required',
      });
    }

    const lead = new SalesLead({
      fullName,
      email,
      companyName,
      companySize,
      projectGoals,
    });

    await lead.save();

    res.status(200).json({
      message: 'Sales request submitted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Server error',
    });
  }
};
