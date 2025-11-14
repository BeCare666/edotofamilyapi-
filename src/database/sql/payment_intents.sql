CREATE TABLE IF NOT EXISTS payment_intents (
      id INT PRIMARY KEY AUTO_INCREMENT,                   
    order_id INT NOT NULL,              
    tracking_number VARCHAR(255) NOT NULL,     
    payment_gateway VARCHAR(50) NOT NULL,      
    payment_intent_info JSON NOT NULL,         
    status ENUM(
        'payment-pending',
        'payment-processing',
        'payment-success',
        'payment-failed',
        'payment-cash-on-delivery',
        'payment-cash',
        'payment-wallet',
        'payment-awaiting-for-approval'
    ) DEFAULT 'payment-pending',
    total_amount DECIMAL(12,2) NOT NULL,       
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
