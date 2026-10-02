import "./index.css";
import { PortraitComposition } from "./Portrait";
import { DeliveryComposition } from './DeliveryVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <PortraitComposition />
      <DeliveryComposition />
    </>
  );
};
