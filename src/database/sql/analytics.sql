CREATE TABLE IF NOT EXISTS analytics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    totalRevenue DECIMAL(12,2) NOT NULL DEFAULT 0,
    totalRefunds DECIMAL(12,2) NOT NULL DEFAULT 0,
    totalShops INT NOT NULL DEFAULT 0,
    totalVendors INT NOT NULL DEFAULT 0,
    todaysRevenue DECIMAL(12,2) NOT NULL DEFAULT 0,
    totalOrders INT NOT NULL DEFAULT 0,
    newCustomers INT NOT NULL DEFAULT 0,
    shop_id INT DEFAULT NULL,
    totalYearSaleByMonth JSON NOT NULL DEFAULT ('[]'),
    todayTotalOrderByStatus JSON NOT NULL DEFAULT ('{}'),
    weeklyTotalOrderByStatus JSON NOT NULL DEFAULT ('{}'),
    monthlyTotalOrderByStatus JSON NOT NULL DEFAULT ('{}'),
    yearlyTotalOrderByStatus JSON NOT NULL DEFAULT ('{}'),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
