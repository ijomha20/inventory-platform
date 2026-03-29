declare global {
  namespace Express {
    interface User {
      email:   string;
      name:    string;
      picture: string;
    }
  }
}

export {};
