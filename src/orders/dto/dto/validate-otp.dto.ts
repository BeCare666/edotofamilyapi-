export class ValidateOtpDto {
    tracking_number: string;
    otp: string;
    pickup_point_id?: number;
    delivered_by_user_id?: number;
    delivery_type: 'pickup' | 'home_delivery';
}
