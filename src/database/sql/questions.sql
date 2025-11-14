CREATE TABLE IF NOT EXISTS questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    shop_id INT,
    product_id INT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    positive_feedbacks_count INT DEFAULT 0,
    negative_feedbacks_count INT DEFAULT 0,
    my_feedback TEXT,
    abusive_reports_count INT DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);
