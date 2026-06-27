import { auth, db } from './firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { updateEmail, updatePassword } from 'firebase/auth';

/** Get user profile from Firestore */
export async function getUserProfile(uid) {
  const userDoc = doc(db, 'users', uid);
  const snap = await getDoc(userDoc);
  return snap.exists() ? snap.data() : null;
}

/** Save user profile to Firestore */
export async function saveUserProfile(uid, profile) {
  const userDoc = doc(db, 'users', uid);
  await setDoc(userDoc, profile, { merge: true });
}

/** Update email in Auth and Firestore */
export async function updateUserEmail(uid, newEmail) {
  if (auth.currentUser) {
    await updateEmail(auth.currentUser, newEmail);
    await updateDoc(doc(db, 'users', uid), { email: newEmail });
  }
}

/** Change password */
export async function changeUserPassword(newPassword) {
  if (auth.currentUser) {
    await updatePassword(auth.currentUser, newPassword);
  }
}
