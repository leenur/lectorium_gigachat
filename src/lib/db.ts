import { collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp, setDoc, doc, getDocs } from 'firebase/firestore';
import { db } from './firebase';

export { db, collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp, setDoc, doc, getDocs };
