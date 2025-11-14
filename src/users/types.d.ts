interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        // tu peux ajouter email, role, etc. si tu veux
    };
}
