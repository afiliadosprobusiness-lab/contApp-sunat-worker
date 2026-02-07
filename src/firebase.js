import admin from "firebase-admin";

const initFirebase = () => {
  if (admin.apps.length) return admin;

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountRaw) {
    const serviceAccount = JSON.parse(serviceAccountRaw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  return admin;
};

export const firebaseAdmin = initFirebase();
export const firestore = firebaseAdmin.firestore();
