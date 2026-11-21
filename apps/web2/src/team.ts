import nathapornPhoto from './assets/team/nathaporn.webp';
import natchaponPhoto from './assets/team/natchapon.webp';
import siriphanaphornPhoto from './assets/team/siriphanaphorn.webp';

interface TeamMember {
  name: string;
  role: string;
  description: { th: string; en: string };
  avatar: string;
}

export const TEAM: TeamMember[] = [
  {
    name: 'Nathaporn Saituptim',
    role: 'Team Lead / Developer',
    description: { th: 'นำทีมและดูแลการพัฒนาแอป Walk We', en: 'Leads the team and develops Walk We.' },
    avatar: nathapornPhoto,
  },
  {
    name: 'Natchapon Thiradechanun',
    role: 'AI Engineer / Developer',
    description: { th: 'ดูแลงานวิศวกรรม AI และร่วมพัฒนาแอป', en: 'Works on AI engineering and app development.' },
    avatar: natchaponPhoto,
  },
  {
    name: 'Siriphanaphorn Sirikun',
    role: 'Support',
    description: { th: 'ประสานงานและสนับสนุนการทำงานของทีม', en: 'Coordinates and supports the team’s work.' },
    avatar: siriphanaphornPhoto,
  },
];
