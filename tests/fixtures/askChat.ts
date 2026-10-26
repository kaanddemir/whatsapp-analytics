/* A synthetic one-to-one chat for the Ask interface tests. No real chats.
   Enough of everything an answer can show: a comparison, a topic mentioned
   in more messages than an answer cites at first (paging), a plan with a
   reply, a media placeholder and an edited message, and wording the fake
   embedding model relates to "moving" without sharing a word with it. */
import { android, lines } from "../support/export";

const rows: string[] = [];
const add = (d: string, t: string, who: string, text: string) => rows.push(android(d, t, who, text));
add("05/01/2024", "09:00", "Ayşe", "Good morning! Did you get the concert tickets?");
add("05/01/2024", "09:04", "Can", "Not yet, the concert sold out fast");
add("05/01/2024", "09:06", "Ayşe", "Maybe there is another concert in March");
add("05/01/2024", "21:10", "Can", "<Media omitted>");
add("12/01/2024", "18:30", "Ayşe", "Shall we meet tomorrow at 19:00?");
add("12/01/2024", "18:35", "Can", "Sure, see you then");
add("20/01/2024", "10:00", "Can", "The concert was amazing last year");
add("20/01/2024", "10:02", "Ayşe", "I still have the concert poster <This message was edited>");
add("02/02/2024", "08:15", "Ayşe", "yeni eve geçsek mi diye düşünüyorum");
add("02/02/2024", "08:20", "Can", "olabilir, bakalım");
add("14/02/2024", "20:00", "Ayşe", "Another concert next week?");
add("14/02/2024", "20:05", "Can", "Only if the concert is cheap");
add("01/03/2024", "12:00", "Ayşe", "Lunch?");
add("01/03/2024", "12:01", "Ayşe", "I am hungry");
add("01/03/2024", "12:30", "Can", "On my way");
add("10/03/2024", "19:00", "Ayşe", "Sorry, I am late");
add("10/03/2024", "19:20", "Can", "No problem");
add("22/03/2024", "22:45", "Ayşe", "Good night");

export const ASK_CHAT = lines(...rows);
