import { PrismaClient } from '@prisma/client';
import express from 'express';

interface AsomCustomer {
  id: string;
  name: string;
  loyaltyTier: DiscountLevel;
}

enum DiscountLevel {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
}

class CustomerLoyaltyService {
  private db: PrismaClient;

  constructor(db: PrismaClient) {
    this.db = db;
  }

  async calculateDiscountTier(customer: AsomCustomer): Promise<DiscountLevel> {
    const orders = await this.db.order.findMany({
      where: { customerId: customer.id },
    });
    const totalSpent = orders.reduce((sum, o) => sum + o.amount, 0);
    return totalSpent > 10000 ? DiscountLevel.GOLD : DiscountLevel.SILVER;
  }
}

const app = express();
app.get('/api/customers/:id/discount', async (req, res) => {
  res.json({ tier: 'gold' });
});
